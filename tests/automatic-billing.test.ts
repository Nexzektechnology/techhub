import {beforeAll,afterAll,it,expect,vi,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
import {encryptAuthorization,decryptAuthorization} from '../src/lib/billing-authorization';
let db:PGlite,cid:string,price:string,initial:string;const cipher='v1.'+'a'.repeat(80);
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','automatic-company');
 await identity(db,actors.root,()=>db.query('select saas_configure_plan($1,$2)',[{id:'starter',name:'Starter',available:true,trial_days:14,grace_days:7,employee_limit:10,storage_bytes:1048576},['branding','commerce']]),'authenticated','aal2');
 price=await identity(db,actors.root,()=>value(db,"select saas_publish_price('starter',1,100000) v"),'authenticated','aal2');
 await db.query("insert into saas_subscriptions(company_id,state,plan_id,period_end,grace_days) values($1,'active','starter',now()-interval '1 minute',7)",[cid]);
 initial=(await identity(db,actors.a,()=>value<{reference:string}>(db,'select saas_create_invoice($1,$2) v',[cid,price]))).reference;
});
afterAll(async()=>db?.close());afterEach(()=>vi.unstubAllEnvs());
it('encrypts reusable authorizations with company-bound authenticated encryption',()=>{
 vi.stubEnv('SAAS_BILLING_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'));const encoded=encryptAuthorization('AUTH_testCode',cid);expect(encoded).not.toContain('AUTH_testCode');expect(decryptAuthorization(encoded,cid)).toBe('AUTH_testCode');expect(()=>decryptAuthorization(encoded,randomUUID())).toThrow();expect(()=>decryptAuthorization(encoded.slice(0,-3)+'bad',cid)).toThrow();
});
it('requires payer consent and keeps encrypted payment credentials inaccessible to tenant clients',async()=>{
 await expect(identity(db,actors.b,()=>db.query("select saas_autopay_intent($1,true,'2026-11-16')",[initial]))).rejects.toThrow('Forbidden');
 await identity(db,actors.a,()=>db.query("select saas_autopay_intent($1,true,'2026-11-16')",[initial]));
 await identity(db,'',()=>db.query("select saas_apply_payment($1,100000,'NGN','success','88001')",[initial]),'service_role');
 await identity(db,'',()=>db.query('select saas_save_autopay($1,$2,$3)',[initial,cipher,'a@tenant.example']),'service_role');
 await expect(identity(db,actors.a,()=>db.query('select authorization_ciphertext from saas_autopay'))).rejects.toThrow('permission denied');
 expect(await identity(db,actors.a,()=>value<{automatic:{enabled:boolean}}>(db,'select saas_autopay_status($1) v',[cid]))).toMatchObject({automatic:{enabled:true}});
});
it('enqueues a due renewal once and reconciles an expired lease without resubmitting a charge',async()=>{
 expect(await identity(db,'',()=>value<number>(db,'select saas_enqueue_renewals() v'),'service_role')).toBe(0);
 await db.query("update saas_subscriptions set period_end=now()-interval '1 minute' where company_id=$1",[cid]);
 expect(await identity(db,'',()=>value<number>(db,'select saas_enqueue_renewals() v'),'service_role')).toBe(1);
 expect(await identity(db,'',()=>value<number>(db,'select saas_enqueue_renewals() v'),'service_role')).toBe(0);
 type Job={id:string;reference:string;lease:string;submit:boolean};const claim=()=>identity(db,'',()=>value<Job[]>(db,'select saas_claim_charge_jobs(5) v'),'service_role');
 const first=(await claim())[0];expect(first.submit).toBe(true);expect(await claim()).toEqual([]);
 await db.query("update saas_charge_jobs set lease_until=now()-interval '1 second' where id=$1",[first.id]);
 const retry=(await claim())[0];expect(retry.submit).toBe(false);expect(retry.reference).toBe(first.reference);
 await expect(identity(db,'',()=>db.query("select saas_finish_charge_job($1,$2,'paid')",[retry.id,retry.lease]),'service_role')).rejects.toThrow('Verified payment required');
 await identity(db,'',()=>db.query("select saas_apply_payment($1,100000,'NGN','success','88002')",[retry.reference]),'service_role');
 await identity(db,'',()=>db.query("select saas_finish_charge_job($1,$2,'paid')",[retry.id,retry.lease]),'service_role');
 expect(await value<string>(db,'select state v from saas_charge_jobs where id=$1',[retry.id])).toBe('done');
});
it('cancels unsent renewals and never reenables authorization when an old payment webhook is replayed',async()=>{
 await db.query("update saas_subscriptions set period_end=now()-interval '1 minute' where company_id=$1",[cid]);
 await identity(db,'',()=>db.query('select saas_enqueue_renewals()'),'service_role');
 await identity(db,actors.a,()=>db.query('select saas_cancel($1,true)',[cid]));
 await identity(db,'',()=>db.query('select saas_save_autopay($1,$2,$3)',[initial,cipher,'a@tenant.example']),'service_role');
 expect(await value<boolean>(db,'select enabled v from saas_autopay where company_id=$1',[cid])).toBe(false);
 expect(await identity(db,'',()=>value<number>(db,'select saas_enqueue_renewals() v'),'service_role')).toBe(0);
 expect((await db.query("select * from saas_invoices where company_id=$1 and status='pending'",[cid])).rows).toHaveLength(0);
});
