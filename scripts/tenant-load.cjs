// Offline by default. Hosted mode requires an explicitly separate staging target.
const fs=require('node:fs'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const hosted=process.argv.includes('--hosted'),runId=crypto.randomUUID(),prefix='load-'+runId.slice(0,8);
const count=Number(process.env.LOAD_COMPANIES||100),usersPerCompany=Number(process.env.LOAD_USERS_PER_COMPANY||10),requests=Number(process.env.LOAD_REQUESTS||2000),concurrency=Number(process.env.LOAD_CONCURRENCY||20);
if(![count,usersPerCompany,requests,concurrency].every(Number.isInteger)||count<2||count>1000||usersPerCompany<1||usersPerCompany>100||requests<100||requests>100000||concurrency<1||concurrency>100)throw Error('Invalid bounded load configuration');
function sourceHash(){const paths=['package.json','package-lock.json','next.config.ts','config/saas-deployment.json'];for(const dir of ['src','supabase/migrations','scripts']){function walk(base){for(const e of fs.readdirSync(base,{withFileTypes:true})){const path=base+'/'+e.name;if(e.isDirectory())walk(path);else paths.push(path);}}walk(dir);}const h=crypto.createHash('sha256');for(const path of paths.sort())h.update(path).update('\0').update(fs.readFileSync(path)).update('\0');return h.digest('hex');}
async function main(){
 let db,pool;
 if(hosted){
  require('@next/env').loadEnvConfig(process.cwd());const connection=process.env.STAGING_DATABASE_URL,ref=process.env.STAGING_PROJECT_REF;
  const problem=require('./saas-hosting-preflight.cjs').stagingTargetProblem(connection,ref,process.env.DATABASE_URL);if(problem)throw Error(problem);
  const {Pool}=require('pg');pool=new Pool({connectionString:connection,max:concurrency,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,...(process.env.STAGING_DATABASE_CA_PATH?{ca:fs.readFileSync(process.env.STAGING_DATABASE_CA_PATH,'utf8')}:{})}});db=pool;
 }else{
  fs.mkdirSync('.data/offline',{recursive:true});require('esbuild').buildSync({entryPoints:['tests/helpers/tenant-db.ts'],outfile:'.data/offline/load-helper.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});db=await require('../.data/offline/load-helper.cjs').tenantDatabase();
 }
 const sql=(query,args=[])=>db.query(query,args);
 async function actor(id,role,fn,aal='aal1'){
  async function work(tx){await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[id,JSON.stringify({sub:id,role,aal})]);await tx.query(`set local role ${role}`);return fn(tx);}
  if(!hosted)return db.transaction(work);
  const client=await pool.connect();try{await client.query('begin');const value=await work(client);await client.query('commit');return value;}catch(e){await client.query('rollback');throw e;}finally{client.release();}
 }
 const result=async(tx,query,args=[])=> (await tx.query(query,args)).rows[0].v;
 const cmd=(id,cid,action,data)=>actor(id,'authenticated',tx=>result(tx,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
 const root=crypto.randomUUID(),setupStart=performance.now();await sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[root,prefix+'-root@example.invalid']);await sql('insert into platform_admins(user_id) values($1)',[root]);
 const brand=(await sql("select brand from platform_companies where id='10000000-0000-4000-8000-000000000001'")).rows[0].brand;
 const companies=[];
 try{
  for(let n=0;n<count;n++){
   const owner=crypto.randomUUID(),slug=prefix+'-'+n;await sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,slug+'@example.invalid']);
   const cid=await actor(root,'authenticated',tx=>result(tx,'select platform_create_company($1,$2,$3,$4,$5) v',[slug,slug,slug+'@example.invalid','enterprise',brand]),'aal2');await sql("update platform_modules set enabled=true where company_id=$1 and module='commerce'",[cid]);
   const branch=(await cmd(owner,cid,'branch',{name:'Main branch'})).id,warehouse=(await cmd(owner,cid,'warehouse',{name:'Main warehouse',address:'Synthetic address',branch_id:branch})).id;
   const category=(await cmd(owner,cid,'category',{name:'Synthetic catalogue'})).id,products=[];
   for(let p=0;p<3;p++){const product=(await cmd(owner,cid,'product',{name:slug+' SKU '+p,slug:'sku-'+p,category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;await cmd(owner,cid,'stock',{warehouse_id:warehouse,product_id:product,delta:1000,reason:'Synthetic load stock fixture'});products.push(product);}
   await cmd(owner,cid,'storefront',{warehouse_id:warehouse,delivery_kobo:5000,published:true});await sql('insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,$2,$3,$4)',[cid,'ACCT_'+runId.replaceAll('-','')+n,slug,root]);
   const role=(await cmd(owner,cid,'role',{name:'Warehouse workload',permissions:['catalogue.read','inventory.read','inventory.adjust','orders.read']})).id,users=[owner];
   for(let k=1;k<usersPerCompany;k++){
    const uid=crypto.randomUUID(),email=slug+'-staff-'+k+'@example.invalid';await sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,email]);
    await actor(owner,'authenticated',tx=>tx.query("select company_set_member($1,$2,'supervisor',true)",[cid,email]));await cmd(owner,cid,'binding',{user_id:uid,role_id:role,scope:'warehouse',warehouse_id:warehouse,active:true});users.push(uid);
   }
   companies.push({cid,slug,owner,warehouse,products,users});
  }
  const setupMs=performance.now()-setupStart,times=[],failures=[],activeUsers=new Set(),activeCompanies=new Set(),operations={catalogue:0,inventory:0,stock:0,checkout:0,isolation:0};let next=0;const started=performance.now();
  async function task(i){const companyIndex=Math.floor(i/20)%count,c=companies[companyIndex],other=companies[(companyIndex+1)%count],uid=c.users[i%c.users.length],kind=i%10,t=performance.now();try{
   activeUsers.add(uid);activeCompanies.add(c.cid);const authorized=await actor(uid,'authenticated',tx=>result(tx,'select tenant_commerce_snapshot($1) v',[c.cid]));if(authorized.company_id!==c.cid||authorized.inventory.some(r=>r.warehouse_id!==c.warehouse))throw Error('ISOLATION: actor context escaped its warehouse');
   if(kind<5){operations.catalogue++;const data=await actor('','anon',tx=>result(tx,'select tenant_storefront($1) v',[c.slug]));if(data.company.id!==c.cid||data.products.some(p=>!c.products.includes(p.id)))throw Error('ISOLATION: catalogue returned another company');}
   else if(kind<7){operations.inventory++;const data=await actor(uid,'authenticated',tx=>result(tx,'select tenant_commerce_snapshot($1) v',[c.cid]));if(data.company_id!==c.cid||data.inventory.some(r=>r.warehouse_id!==c.warehouse))throw Error('ISOLATION: unauthorized warehouse');}
   else if(kind===7){operations.stock++;await cmd(uid,c.cid,'stock',{warehouse_id:c.warehouse,product_id:c.products[0],delta:1,reason:'Synthetic concurrent stock receipt'});}
   else if(kind===8){operations.checkout++;const input={key:crypto.randomUUID(),items:[{product_id:c.products[1],quantity:1,expected_price_kobo:10000,options:{}}],address:{name:'Synthetic Customer',email:'load@example.invalid',street:'123 Synthetic Road',phone:'08012345678',city:'Lagos',state:'Lagos'},coupon:''};const o=await actor(uid,'authenticated',tx=>result(tx,'select tenant_checkout($1,$2) v',[c.slug,input]));const retry=await actor(uid,'authenticated',tx=>result(tx,'select tenant_checkout($1,$2) v',[c.slug,input]));if(retry.id!==o.id)throw Error('IDEMPOTENCY: duplicate checkout');const provider=String(7000000000000+i+Number(runId.replaceAll('-','').slice(0,6).replace(/[a-f]/g,'1'))*100000);for(let r=0;r<2;r++)await actor('','service_role',tx=>tx.query("select tenant_apply_payment($1,15000,'NGN','success',$2)",[o.reference,provider]));}
   else{operations.isolation++;let denied=false;try{await cmd(uid,other.cid,'stock',{warehouse_id:other.warehouse,product_id:other.products[0],delta:1,reason:'Expected cross-company rejection'});}catch(e){if(e.message==='Forbidden')denied=true;else throw e;}if(!denied)throw Error('ISOLATION: cross-company write accepted');const rows=await actor(uid,'authenticated',tx=>tx.query('select * from orders where company_id=$1',[other.cid]));if(rows.rows.length)throw Error('ISOLATION: cross-company private read accepted');}
  }catch(e){failures.push({operation:i,message:e.message});}finally{times.push(performance.now()-t);}}
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<requests){const i=next++;await task(i);}}));
  const elapsedMs=performance.now()-started,sorted=times.sort((a,b)=>a-b),percentile=p=>Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]*100)/100;
  const report={run_id:runId,executed_at:new Date().toISOString(),mode:hosted?'hosted-staging-database':'offline-postgresql-fixture',engine:hosted?'PostgreSQL pooled connections':'PGlite single PostgreSQL session; concurrent requests queued by client',source_sha256:sourceHash(),companies:count,users:count*usersPerCompany,active_companies:activeCompanies.size,active_authenticated_users:activeUsers.size,products:count*3,concurrency,requests,operations,setup_ms:Math.round(setupMs),elapsed_ms:Math.round(elapsedMs),latency_ms:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)},failures:failures.slice(0,20),failure_count:failures.length,isolation_failures:failures.filter(f=>f.message.startsWith('ISOLATION')).length,passed:failures.length===0,production_capacity_certified:false,limitations:hosted?'Direct database workload with synthetic Auth identities; hosted HTTP/Auth/payment/recovery acceptance is separate.':'Offline correctness and contention regression only. This is not a production multi-connection or hosted payment capacity result.'};
  fs.mkdirSync('artifacts',{recursive:true});const output=hosted?'artifacts/tenant-load-hosted.json':'artifacts/tenant-load-offline.json';fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report,failures:report.failures.slice(0,3)},null,2));if(!report.passed)process.exitCode=1;
 }finally{if(pool)await pool.end();else await db.close();}
}
main().catch(error=>{console.error('Tenant workload failed: '+error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL omitted]'));process.exitCode=1;});
