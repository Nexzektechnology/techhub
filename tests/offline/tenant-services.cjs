// Offline integration fixture only. Real application APIs + PostgreSQL RLS,
// simulated identity/payment providers. Never included in the deployed app.
if(process.env.NODE_ENV==='production')throw Error('Offline fixtures cannot run in production');
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs');
fs.mkdirSync('.data/offline',{recursive:true});
require('esbuild').buildSync({entryPoints:['tests/helpers/tenant-db.ts'],outfile:'.data/offline/tenant-db.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
const {tenantDatabase,actors,identity,value,company}=require('../../.data/offline/tenant-db.cjs');
const ORIGIN='http://127.0.0.1:54329',APP='http://127.0.0.1:3200',jwtSecret='offline-fixture-signing-key',control='offline-fixture-control';
const transactions=new Map();let providerId=99000;
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-fixture-control',...headers});res.end(JSON.stringify(data,(_k,v)=>typeof v==='bigint'?Number(v):v));};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function user(id){const name=Object.keys(actors).find(k=>actors[k]===id);return {id,aud:'authenticated',role:'authenticated',email:`${name}@tenant.example`,email_confirmed_at:'2026-01-01T00:00:00Z',confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false,app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};}
function token(id){const now=Math.floor(Date.now()/1000),body=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:id,email:user(id).email,role:'authenticated',aud:'authenticated',aal:'aal1',iat:now,exp:now+7200,iss:ORIGIN+'/auth/v1'});return body+'.'+crypto.createHmac('sha256',jwtSecret).update(body).digest('base64url');}
function session(id){return {access_token:token(id),refresh_token:'offline-refresh-'+id,expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,token_type:'bearer',user:user(id)};}
function claims(req){const bearer=(req.headers.authorization||'').replace(/^Bearer /,'');if(bearer==='offline-service-key')return {role:'service_role',sub:''};if(!bearer||bearer==='sb_publishable_offline')return {role:'anon',sub:''};const [h,p,s]=bearer.split('.');if(!h||!p||s!==crypto.createHmac('sha256',jwtSecret).update(h+'.'+p).digest('base64url'))throw Error('Invalid fixture token');const c=JSON.parse(Buffer.from(p,'base64url'));if(c.exp<Date.now()/1000||!Object.values(actors).includes(c.sub))throw Error('Expired fixture token');return c;}
async function body(req){const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>256000)throw Error('Fixture body too large');parts.push(part);}const text=Buffer.concat(parts).toString();return text?JSON.parse(text):{};}
async function main(){
 const db=await tenantDatabase(),a=await company(db,'a','tenant-a'),b=await company(db,'b','tenant-b');
 await identity(db,actors.root,()=>db.query('select saas_configure_plan($1,$2)',[{id:'starter',name:'Starter',description:'Offline acceptance plan',available:true,trial_days:14,grace_days:7,employee_limit:20,storage_bytes:10485760},['branding','field_operations','commerce']]),'authenticated','aal2');
 const price=await identity(db,actors.root,()=>value(db,"select saas_publish_price('starter',1,100000) v"),'authenticated','aal2');
 await db.query("insert into saas_subscriptions(company_id,plan_id,state,period_end,grace_days) values($1,'starter','trialing',now()+interval '14 days',7),($2,'starter','trialing',now()+interval '14 days',7)",[a,b]);
 const cmd=(who,cid,action,data)=>identity(db,who,()=>value(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
 const fixture={origin:ORIGIN,app:APP,control,actors,companies:{a,b},price,locations:{},products:{}};
 for(const [key,cid]of Object.entries({a,b})){
  const branch=(await cmd(actors[key],cid,'branch',{name:`${key.toUpperCase()} Main Branch`})).id,warehouse=(await cmd(actors[key],cid,'warehouse',{name:`${key.toUpperCase()} Main Warehouse`,address:'Fixture address',branch_id:branch})).id;
  const category=(await cmd(actors[key],cid,'category',{name:`${key.toUpperCase()} Foods`})).id,product=(await cmd(actors[key],cid,'product',{name:`${key.toUpperCase()} Rice`,slug:'rice',category_id:category,brand:key.toUpperCase(),price_kobo:key==='a'?10000:30000,image:'/window.svg',description:'Offline fixture product',options:{},active:true})).id;
  await cmd(actors[key],cid,'stock',{warehouse_id:warehouse,product_id:product,delta:21,reason:'Verified fixture opening stock'});await cmd(actors[key],cid,'storefront',{warehouse_id:warehouse,delivery_kobo:5000,published:true});
  await db.query('insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,$2,$3,$4)',[cid,'ACCT_fixture'+key,'tenant-'+key,actors.root]);fixture.locations[key]={branch,warehouse};fixture.products[key]=product;
 }
 await db.query("insert into platform_domains(host,company_id,verified,verified_until,state,tls_ready) values('wenlas.example.test',$1,true,now()+interval '30 days','active',true)",[a]);
 const privateBranch=(await cmd(actors.a,a,'branch',{name:'A Restricted Branch'})).id,privateWarehouse=(await cmd(actors.a,a,'warehouse',{name:'A Restricted Warehouse',branch_id:privateBranch,address:'Private location'})).id;
 await cmd(actors.a,a,'stock',{warehouse_id:privateWarehouse,product_id:fixture.products.a,delta:999,reason:'Private warehouse fixture stock'});fixture.locations.private={branch:privateBranch,warehouse:privateWarehouse};
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));
 const role=(await cmd(actors.a,a,'role',{name:'Warehouse officer',permissions:['catalogue.read','inventory.read','inventory.adjust']})).id;await cmd(actors.a,a,'binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:fixture.locations.a.warehouse,active:true});
 const tables=new Set((await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')")).rows.map(t=>t.relname));
 async function asRequest(req,fn){const c=claims(req);return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[c.sub||'',JSON.stringify(c)]);await tx.exec(`set local role ${c.role}`);return fn(tx);});}
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,ORIGIN);try{
  if(req.method==='OPTIONS')return json(res,204,{});
  if(url.pathname==='/health')return json(res,200,{ok:true});
  if(url.pathname==='/__fixture'&&req.headers['x-fixture-control']===control){const data=await body(req);
   if(data.action==='complete'){const charge=transactions.get(data.reference);if(!charge)throw Error('Unknown fixture charge');charge.status=data.status||'success';const raw=JSON.stringify({event:'charge.success',data:{reference:data.reference}}),signature=crypto.createHmac('sha512',charge.secret).update(raw).digest('hex');const target=data.reference.startsWith('edge-saas-')?'/api/saas/billing/webhook':'/api/payments/webhook';const response=await fetch(APP+target,{method:'POST',body:raw,headers:{'content-type':'application/json','x-paystack-signature':signature}});return json(res,200,{webhookStatus:response.status});}
   if(data.action==='due'){await db.query("update saas_subscriptions set period_end=now()-interval '1 second' where company_id=$1",[data.company_id]);return json(res,200,{ok:true});}
   if(data.action==='status'){const rows=await db.query('select company_id,state,period_end,cancel_at_period_end from saas_subscriptions');return json(res,200,{subscriptions:rows.rows,charges:[...transactions.values()].map(t=>({reference:t.reference,status:t.status,amount:t.amount})),jobs:(await db.query('select reference,state,attempts from saas_charge_jobs')).rows});}
   return json(res,400,{error:'Invalid fixture control'});
  }
  if(url.pathname.startsWith('/auth/v1/')){
   if(url.pathname==='/auth/v1/user'){const c=claims(req);if(!c.sub)return json(res,401,{message:'No session'});return json(res,200,user(c.sub));}
   if(url.pathname==='/auth/v1/logout')return json(res,200,{});
   if(url.pathname==='/auth/v1/token'){const data=await body(req);const id=Object.entries(actors).find(([name])=>data.email===`${name}@tenant.example`||data.refresh_token==='offline-refresh-'+actors[name])?.[1];if(!id||data.password&&data.password!=='tenant-test-password')return json(res,400,{message:'Invalid fixture credentials'});return json(res,200,session(id));}
   return json(res,404,{message:'Fixture auth route unavailable'});
  }
  if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1);if(!/^[a-z_]+$/.test(name))throw Error('Invalid RPC');const args=await body(req),keys=Object.keys(args);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw Error('Invalid argument');
   const meta=(await db.query('select proretset from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1',[name])).rows[0];if(!meta)throw Error('Missing RPC');
   const call=`public."${name}"(${keys.map((k,i)=>`"${k}"=>$${i+1}`).join(',')})`;const result=await asRequest(req,tx=>tx.query(meta.proretset?`select * from ${call}`:`select ${call} result`,Object.values(args)));return json(res,200,meta.proretset?result.rows:result.rows[0]?.result??null);
  }
  if(url.pathname.startsWith('/rest/v1/')){const table=url.pathname.split('/').at(-1);if(!tables.has(table)||!['GET','HEAD'].includes(req.method))return json(res,405,{message:'Fixture table route is read-only'});const columns=url.searchParams.get('select')||'*';if(columns!=='*'&&!/^[a-z_,]+$/.test(columns))throw Error('Invalid columns');const args=[],where=[];
   for(const [key,filter]of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;if(!/^[a-z_]+$/.test(key))throw Error('Invalid filter');const [op,...rest]=filter.split('.'),v=rest.join('.');if(op==='is'&&v==='null')where.push(`"${key}" is null`);else if(op==='like'||op==='not'&&rest[0]==='like'){args.push(op==='like'?v:rest.slice(1).join('.'));where.push(`"${key}" ${op==='not'?'not ':''}like $${args.length}`);}else if(['eq','neq','gt','gte','lt','lte'].includes(op)){args.push(v);where.push(`"${key}" ${ {eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[op]} $${args.length}`);}else throw Error('Unsupported fixture filter');}
   let order='';const sort=url.searchParams.get('order');if(sort){const parts=sort.split(',');if(parts.some(p=>!/^([a-z_]+)(\.(asc|desc))?$/.test(p)))throw Error('Invalid order');order=' order by '+parts.map(p=>{const [column,direction='asc']=p.split('.');return `"${column}" ${direction}`;}).join(',');}
   const limit=Math.min(1000,Math.max(0,Number(url.searchParams.get('limit')||1000))),selected=columns==='*'?'*':columns.split(',').map(c=>`"${c}"`).join(',');const result=await asRequest(req,tx=>tx.query(`select ${selected} from public."${table}"${where.length?' where '+where.join(' and '):''}${order} limit ${limit}`,args));
   const single=(req.headers.accept||'').includes('vnd.pgrst.object');return json(res,single&&result.rows.length!==1?406:200,req.method==='HEAD'?null:single?result.rows[0]:result.rows,{'Content-Range':`0-${Math.max(0,result.rows.length-1)}/${result.rows.length}`});
  }
  if(url.pathname.startsWith('/transaction/')){const secret=(req.headers.authorization||'').replace(/^Bearer /,'');if(!['sk_test_commerce_offline','sk_test_saas_offline'].includes(secret))return json(res,401,{status:false});
   if(['/transaction/initialize','/transaction/charge_authorization'].includes(url.pathname)){const data=await body(req);if(transactions.has(data.reference))return json(res,400,{status:false,message:'Duplicate reference'});transactions.set(data.reference,{id:++providerId,reference:data.reference,amount:Number(data.amount),currency:data.currency,status:url.pathname.includes('charge_authorization')?'success':'pending',secret,customer:{email:data.email},authorization:{reusable:true,authorization_code:'AUTH_offlineCard'},subaccount:{subaccount_code:data.subaccount}});return json(res,200,{status:true,data:{authorization_url:'https://checkout.paystack.com/'+data.reference,reference:data.reference}});}
   const ref=decodeURIComponent(url.pathname.split('/').at(-1)),transaction=transactions.get(ref);return json(res,transaction?200:404,{status:!!transaction,data:transaction});
  }
  return json(res,404,{message:'Offline fixture route unavailable'});
 }catch(e){return json(res,e.message==='Forbidden'||e.code==='42501'?403:400,{message:e.message,code:e.code||'fixture',details:null,hint:null});}});
 server.listen(54329,'127.0.0.1',()=>{fs.writeFileSync('.data/offline/tenant-fixture.json',JSON.stringify(fixture,null,2));console.log('Offline identity, payment and PostgreSQL fixtures ready on loopback. No external services connected.');});
 const stop=()=>server.close(async()=>{await db.close();process.exit();});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
main().catch(e=>{console.error('Offline fixture failed:',e.message);process.exitCode=1;});
