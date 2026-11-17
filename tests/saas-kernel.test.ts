import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {companyTheme} from '../src/lib/saas-contract';
let db:PGlite,a:string,b:string,price:string,scenario=false;
const [ownerA,ownerB,root,outsider,employee]=Array.from({length:5},(_,i)=>`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const theme=companyTheme('Acme Company','#2457C5','acme@example.com','');
async function as<T>(id:string,fn:()=>Promise<T>,aal='aal1',role='authenticated'):Promise<T>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,aal})]);await db.exec(`set role ${role}`);
 if(scenario)await db.exec('savepoint identity_action');
 try{const result=await fn();if(scenario)await db.exec('release savepoint identity_action');return result;}
 catch(e){if(scenario){await db.exec('rollback to savepoint identity_action');await db.exec('release savepoint identity_action');}throw e;}
 finally{await db.exec('reset role');}
}
const scalar=async<T=string>(sql:string,args:unknown[]=[])=>{const r=await db.query<{v:T}>(sql,args);return r.rows[0].v;};
const registration=(slug:string)=>({name:'Acme Company',slug,plan_id:'starter',category:'Retail',email:'acme@example.com',address:'12 Test Street',phone:'',registration_number:''});
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;`);
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
  if(file.startsWith('009'))await db.exec('alter default privileges in schema public grant all on tables to authenticated');
  await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 }
 for(const [i,id] of [ownerA,ownerB,root,outsider,employee].entries())await db.query('insert into auth.users values($1,$2,now())',[id,`saas${i}@example.com`]);
 await db.query('insert into platform_admins(user_id) values($1)',[root]);
 await as(root,()=>db.query('select saas_configure_plan($1,$2)',[{id:'starter',name:'Starter',available:true,trial_days:14,grace_days:7,employee_limit:2,storage_bytes:1024,description:'Test'},['branding','field_operations']]),'aal2');
 price=await as(root,()=>scalar('select saas_publish_price($1,1,100000) v',['starter']),'aal2');
 a=await as(ownerA,()=>scalar('select saas_onboard($1,$2,$3) v',[randomUUID(),registration('saas-a'),theme]));
 b=await as(ownerB,()=>scalar('select saas_onboard($1,$2,$3) v',[randomUUID(),registration('saas-b'),theme]));
});
afterAll(async()=>db?.close());
it('requires verified identity, denies anonymous accounts and retries tenant registration without duplication',async()=>{
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[outsider]);
 await expect(as(outsider,()=>db.query('select saas_onboard($1,$2,$3)',[randomUUID(),registration('no-email'),theme]))).rejects.toThrow('verified email');
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[outsider]);
 await as(outsider,async()=>{await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:outsider,is_anonymous:true})]);await expect(db.query('select saas_onboard($1,$2,$3)',[randomUUID(),registration('anonymous'),theme])).rejects.toThrow('verified email');});
 const key=randomUUID();const input=registration('saas-retry');const first=await as(outsider,()=>scalar('select saas_onboard($1,$2,$3) v',[key,input,theme]));
 expect(await as(outsider,()=>scalar('select saas_onboard($1,$2,$3) v',[key,input,theme]))).toBe(first);
 const retryKey=randomUUID();expect(await as(outsider,()=>scalar('select saas_onboard($1,$2,$3) v',[retryKey,input,theme]))).toBe(first);
 await expect(as(outsider,()=>db.query('select saas_onboard($1,$2,$3)',[retryKey,registration('changed-alias'),theme]))).rejects.toThrow('key already used');
 await expect(as(outsider,()=>db.query('select saas_onboard($1,$2,$3)',[key,registration('changed'),theme]))).rejects.toThrow('key already used');
});
it('denies direct cross-company billing, domains, storage, branding and mutation access',async()=>{
 await as(ownerB,async()=>{
  expect((await db.query('select * from saas_subscriptions where company_id=$1',[a])).rows).toEqual([]);
  for(const [sql,args] of [
   ['select saas_create_invoice($1,$2)',[a,price]],['select saas_portal($1)',['saas-a']],
   ['select saas_request_domain($1,$2)',[a,'shop.example.com']],['select saas_reserve_asset($1,$2,$3,100)',[a,'documents','application/pdf']],
   ['select company_brand($1,$2,$3)',[a,'publish',theme]],['select saas_cancel($1,true)',[a]],
  ] as [string,unknown[]][])await expect(db.query(sql,args)).rejects.toThrow('Forbidden');
  await expect(db.query("update saas_subscriptions set state='active' where company_id=$1",[b])).rejects.toThrow('permission denied');
  await expect(db.query("select saas_apply_payment('x',100,'NGN','success','1')")).rejects.toThrow('permission denied');
 });
});
it('enforces employee limits in SQL and preserves secure multi-company switching',async()=>{
 await as(ownerA,()=>db.query("select company_set_member($1,'saas4@example.com','supervisor',true)",[a]));
 await expect(as(ownerA,()=>db.query("select company_set_member($1,'saas3@example.com','supervisor',true)",[a]))).rejects.toThrow('Employee limit');
 await as(ownerB,()=>db.query("select company_set_member($1,'saas4@example.com','supervisor',true)",[b]));
 await as(employee,async()=>{expect(await scalar('select company_role($1) v',[a])).toBe('supervisor');expect(await scalar('select company_role($1) v',[b])).toBe('supervisor');expect(await scalar('select company_role($1) v',[randomUUID()])).toBeNull();});
});
it('checks immutable invoice totals and applies duplicate verified payments once',async()=>{
 const i=await as(ownerA,()=>scalar<{id:string;reference:string;amount_kobo:number}>('select saas_create_invoice($1,$2) v',[a,price]));
 expect((await as(ownerA,()=>scalar<{id:string}>('select saas_create_invoice($1,$2) v',[a,price]))).id).toBe(i.id);
 const apply=(amount:number,currency='NGN',provider='1001')=>as('',()=>scalar<{period_end:string}>('select saas_apply_payment($1,$2,$3,$4,$5) v',[i.reference,amount,currency,'success',provider]),'aal1','service_role');
 await expect(apply(1)).rejects.toThrow('mismatch');await expect(apply(i.amount_kobo,'USD')).rejects.toThrow('mismatch');
 const first=await apply(i.amount_kobo),second=await apply(i.amount_kobo);expect(first.period_end).toBe(second.period_end);
 await expect(apply(i.amount_kobo,'NGN','1002')).rejects.toThrow('mismatch');
 expect(await scalar<number>('select count(*)::int v from saas_invoices where company_id=$1 and status=\'paid\'',[a])).toBe(1);
});
it('requires ownership proof and separate MFA-protected TLS activation before hostname resolution',async()=>{
 const d=await as(ownerA,()=>scalar<{challenge:string}>('select saas_request_domain($1,$2) v',[a,'workspace.example.com']));
 expect(await scalar('select saas_resolve_host($1) v',['workspace.example.com'])).toBeNull();
 await expect(as(ownerB,()=>db.query('select saas_request_domain($1,$2)',[b,'workspace.example.com']))).rejects.toThrow('unavailable');
 await expect(as(ownerA,()=>db.query('select saas_verify_domain($1,$2)',['workspace.example.com',d.challenge]))).rejects.toThrow('permission denied');
 await as('',()=>db.query('select saas_verify_domain($1,$2)',['workspace.example.com',d.challenge]),'aal1','service_role');
 expect(await scalar('select saas_resolve_host($1) v',['workspace.example.com'])).toBeNull();
 await expect(as(root,()=>db.query("select saas_activate_domain('workspace.example.com',true)"))).rejects.toThrow('Forbidden');
 await as(root,()=>db.query("select saas_activate_domain('workspace.example.com',true)"),'aal2');
 expect(await scalar('select saas_resolve_host($1) v',['workspace.example.com'])).toBe('saas-a');
 await db.query("update platform_domains set verified_until=now()-interval '1 second'");expect(await scalar('select saas_resolve_host($1) v',['workspace.example.com'])).toBeNull();
});
it('locks storage allocation, protects paths and objects, and forbids direct upload bypass',async()=>{
 const asset=await as(ownerA,()=>scalar<{id:string;path:string}>("select saas_reserve_asset($1,'documents','application/pdf',800) v",[a]));
 expect(asset.path).toMatch(new RegExp(`^tenants/${a}/documents/`));
 await expect(as(ownerA,()=>db.query("select saas_reserve_asset($1,'documents','application/pdf',800)",[a]))).rejects.toThrow('Storage limit');
 await as('',()=>db.query('select saas_finalize_asset($1,true)',[asset.id]),'aal1','service_role');
 await db.query("insert into storage.objects values($1,'tenant-files',$2)",[randomUUID(),asset.path]);
 expect((await as(ownerA,()=>db.query("select * from storage.objects where bucket_id='tenant-files'"))).rows).toHaveLength(1);
 expect((await as(ownerB,()=>db.query("select * from storage.objects where bucket_id='tenant-files'"))).rows).toHaveLength(0);
 await expect(as(ownerA,()=>db.query("insert into storage.objects values($1,'tenant-files',$2)",[randomUUID(),asset.path]))).rejects.toThrow('row-level security');
 await expect(as(ownerA,()=>db.query("select saas_reserve_asset($1,'../../other','application/pdf',1)",[a]))).rejects.toThrow('Invalid file');
});
it('makes expired companies read-only while retaining billing recovery and private files',async()=>{
 await db.query("update saas_subscriptions set state='active',period_end=now()-interval '2 days',grace_days=1 where company_id=$1",[b]);
 expect(await as(ownerB,()=>scalar('select saas_access($1) v',[b]))).toBe('read_only');
 await expect(as(ownerB,()=>db.query("select field_save_outlet($1,null,'New outlet','123 Test Street','','',null,null)",[b]))).rejects.toThrow('read-only');
 await expect(as(ownerB,()=>db.query("select company_brand($1,'draft',$2)",[b,theme]))).rejects.toThrow('read-only');
 expect(await as(ownerB,()=>scalar<{access:string}>('select saas_portal($1) v',['saas-b']))).toMatchObject({access:'read_only'});
 expect(await as(ownerB,()=>scalar('select saas_create_invoice($1,$2) v',[b,price]))).toBeTruthy();
});
it('requires MFA for plan management, keeps unported modules disabled, and leaves existing access grandfathered',async()=>{
 await expect(as(root,()=>db.query("select saas_publish_price('starter',1,999)"))).rejects.toThrow('Forbidden');
 await expect(as(root,()=>db.query('select saas_configure_plan($1,$2)',[{id:'starter'},['delivery']]),'aal2')).rejects.toThrow('not provisioned');
 expect((await db.query("select * from platform_modules where module in ('commerce','delivery') and enabled")).rows).toEqual([]);
 expect(await scalar('select saas_access($1) v',['10000000-0000-4000-8000-000000000001'])).toBe('grandfathered');
 const overview=await as(root,()=>scalar<{total:number;mrr_kobo:number}>('select saas_platform_overview(1) v'),'aal2');expect(overview.total).toBeGreaterThanOrEqual(3);expect(Number(overview.mrr_kobo)).toBe(100000);
});
it('retains grace-period writes, removes them on end-of-period cancellation, and preserves records',async()=>{
 await db.query('begin');scenario=true;try{
  await db.query("update saas_subscriptions set state='active',period_end=now()-interval '1 day',grace_days=7,cancel_at_period_end=false where company_id=$1",[a]);
  expect(await as(ownerA,()=>scalar('select saas_access($1) v',[a]))).toBe('grace');
  await as(ownerA,()=>db.query('select saas_cancel($1,true)',[a]));expect(await as(ownerA,()=>scalar('select saas_access($1) v',[a]))).toBe('read_only');
  expect((await as(ownerA,()=>db.query('select * from saas_invoices where company_id=$1',[a]))).rows.length).toBeGreaterThan(0);
 }finally{scenario=false;await db.query('rollback');}
});
it('blocks stale payment periods, ambiguous initialization and duplicate provider identities',async()=>{
 await db.query('begin');scenario=true;try{
  const i=await as(ownerA,()=>scalar<{reference:string;id:string;amount_kobo:number}>('select saas_create_invoice($1,$2) v',[a,price]));
  await as('',()=>db.query('select saas_claim_initialization($1)',[i.reference]),'aal1','service_role');
  await expect(as('',()=>db.query('select saas_claim_initialization($1)',[i.reference]),'aal1','service_role')).rejects.toThrow('reconciliation');
  await expect(as('',()=>db.query('select saas_save_initialization($1,$2)',[i.reference,'https://attacker.example/pay']),'aal1','service_role')).rejects.toThrow('Invalid provider URL');
  await expect(as('',()=>db.query('select saas_apply_payment($1,$2,$3,$4,$5)',[i.reference,i.amount_kobo,'NGN','success','1001']),'aal1','service_role')).rejects.toThrow('unique');
  await db.query("update saas_subscriptions set period_end=period_end+interval '1 day' where company_id=$1",[a]);
  await expect(as('',()=>db.query('select saas_apply_payment($1,$2,$3,$4,$5)',[i.reference,i.amount_kobo,'NGN','success','9001']),'aal1','service_role')).rejects.toThrow('reconciliation');
 }finally{scenario=false;await db.query('rollback');}
});
it('reserves invitation seats and skips expired invitations during sign-in without expanding access',async()=>{
 await db.query('begin');scenario=true;try{
  await as(ownerA,()=>db.query("select company_set_member($1,'saas4@example.com','supervisor',false)",[a]));
  await as(ownerA,()=>db.query("select company_prepare_staff($1,'saas3@example.com','Invited Colleague','','supervisor',null)",[a]));
  await expect(as(ownerA,()=>db.query("select company_set_member($1,'saas4@example.com','supervisor',true)",[a]))).rejects.toThrow('Employee limit');
  await db.query("update saas_subscriptions set period_end=now()-interval '60 days' where company_id=$1",[a]);
  await as(outsider,()=>db.query('select company_claim_staff()'));expect(await as(outsider,()=>scalar('select company_role($1) v',[a]))).toBeNull();
 }finally{scenario=false;await db.query('rollback');}
});
it('limits expensive operations per verified user in a durable database bucket',async()=>{
 for(let n=0;n<20;n++)await as(ownerB,()=>db.query("select saas_rate_limit('billing')"));
 await expect(as(ownerB,()=>db.query("select saas_rate_limit('billing')"))).rejects.toThrow('limit reached');
});
