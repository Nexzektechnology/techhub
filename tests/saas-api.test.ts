import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {createHmac} from 'node:crypto';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),trustedRpc:vi.fn(),single:vi.fn(),fetch:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:async()=>({db:{rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({single:mocks.single})})})},user:{id:'owner-a',email:'owner@example.com'}})}));
vi.mock('../src/lib/server',()=>({supabase:vi.fn(),service:()=>({rpc:mocks.trustedRpc,from:()=>({select:()=>({eq:()=>({single:mocks.single})})})})}));
import {POST as command} from '../src/app/api/saas/route';
import {POST as billing} from '../src/app/api/saas/billing/route';
import {POST as webhook} from '../src/app/api/saas/billing/webhook/route';
const origin='https://example.com',ref='edge-saas-30000000-0000-4000-8000-000000000099';
const invoice={id:'invoice-a',reference:ref,company_id:'30000000-0000-4000-8000-000000000001',amount_kobo:100000,currency:'NGN'};
const request=(path:string,body:unknown,source=origin)=>new Request(origin+path,{method:'POST',headers:{origin:source,'Content-Type':'application/json'},body:JSON.stringify(body)});
const verified={reference:ref,amount:100000,currency:'NGN',status:'success',id:12345};
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('NODE_ENV','production');vi.stubEnv('NEXT_PUBLIC_SITE_URL',origin);vi.stubEnv('SAAS_PAYSTACK_SECRET_KEY','sk_test_saas');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-service');
 vi.stubGlobal('fetch',mocks.fetch);mocks.rpc.mockResolvedValue({data:invoice,error:null});mocks.single.mockResolvedValue({data:invoice,error:null});mocks.trustedRpc.mockResolvedValue({data:{},error:null});mocks.fetch.mockResolvedValue({ok:true,json:async()=>({status:true,data:verified})});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('rejects cross-origin mutation before querying identity-scoped data or calling provider',async()=>{
 expect((await command(request('/api/saas',{action:'cancel',company_id:invoice.company_id,cancel:true},'https://attacker.example'))).status).toBe(400);
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.trustedRpc).not.toHaveBeenCalled();
});
it('uses the SQL-authorized company selector and never accepts a client payment amount',async()=>{
 const r=await billing(request('/api/saas/billing',{action:'checkout',company_id:invoice.company_id,price_id:'30000000-0000-4000-8000-000000000007',amount:1}));expect(r.status).toBe(400);expect(mocks.fetch).not.toHaveBeenCalled();
 mocks.rpc.mockImplementation(async(name:string)=>name==='saas_rate_limit'?{data:null,error:null}:{error:{message:'Forbidden'}});expect((await billing(request('/api/saas/billing',{action:'checkout',company_id:invoice.company_id,price_id:'30000000-0000-4000-8000-000000000007'}))).status).toBe(403);expect(mocks.rpc).toHaveBeenCalledWith('saas_create_invoice',{p_company:invoice.company_id,p_price:'30000000-0000-4000-8000-000000000007'});expect(mocks.trustedRpc).not.toHaveBeenCalled();
});
it('refuses unconfigured SaaS billing even when legacy commerce credentials exist',async()=>{
 vi.stubEnv('SAAS_PAYSTACK_SECRET_KEY','');vi.stubEnv('PAYSTACK_SECRET_KEY','legacy-key');expect((await billing(request('/api/saas/billing',{action:'verify',reference:ref}))).status).toBe(400);expect(mocks.fetch).not.toHaveBeenCalled();
});
it('verifies provider identity and immutable amount before applying a payment',async()=>{
 const r=await billing(request('/api/saas/billing',{action:'verify',reference:ref}));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({paid:true});
 expect(mocks.trustedRpc).toHaveBeenCalledWith('saas_apply_payment',{p_reference:ref,p_amount:100000,p_currency:'NGN',p_status:'success',p_provider_id:'12345'});
 expect(mocks.fetch).toHaveBeenCalledWith(`https://api.paystack.co/transaction/verify/${ref}`,expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer sk_test_saas'})}));
});
it('rejects mismatched provider responses without activating access',async()=>{
 for(const bad of [{...verified,amount:1},{...verified,currency:'USD'},{...verified,reference:'other'},{...verified,status:'pending'},{...verified,id:Number.MAX_SAFE_INTEGER+1}]){
  mocks.fetch.mockResolvedValue({ok:true,json:async()=>({status:true,data:bad})});expect((await billing(request('/api/saas/billing',{action:'verify',reference:ref}))).status).toBe(400);
 }expect(mocks.trustedRpc).not.toHaveBeenCalled();
});
it('allows a fresh checkout only after independent final-failure evidence',async()=>{
 mocks.fetch.mockResolvedValue({ok:true,json:async()=>({status:true,data:{...verified,status:'failed'}})});const r=await billing(request('/api/saas/billing',{action:'verify',reference:ref}));expect(await r.json()).toMatchObject({ok:true,paid:false});expect(mocks.trustedRpc).toHaveBeenCalledWith('saas_void_failed_invoice',{p_reference:ref,p_status:'failed'});
});
it('never reinitializes ambiguous payments and resumes stored provider sessions',async()=>{
 mocks.trustedRpc.mockResolvedValueOnce({error:{message:'Payment initialization requires reconciliation'}});
 expect((await billing(request('/api/saas/billing',{action:'resume',reference:ref}))).status).toBe(400);expect(mocks.fetch).not.toHaveBeenCalled();
 mocks.trustedRpc.mockResolvedValueOnce({data:{url:'https://checkout.paystack.com/session-1'},error:null});const r=await billing(request('/api/saas/billing',{action:'resume',reference:ref}));expect(await r.json()).toMatchObject({url:'https://checkout.paystack.com/session-1'});expect(mocks.fetch).not.toHaveBeenCalled();
});
it('checks raw webhook HMAC before looking up invoices and ignores other applications references',async()=>{
 const body=JSON.stringify({event:'charge.success',data:{reference:ref}});
 expect((await webhook(new Request(origin+'/api/saas/billing/webhook',{method:'POST',body,headers:{'x-paystack-signature':'bad'}}))).status).toBe(401);expect(mocks.single).not.toHaveBeenCalled();
 const foreign=JSON.stringify({event:'charge.success',data:{reference:'edge-other-app'}});const sig=createHmac('sha512','sk_test_saas').update(foreign).digest('hex');expect((await webhook(new Request(origin+'/api/saas/billing/webhook',{method:'POST',body:foreign,headers:{'x-paystack-signature':sig}}))).status).toBe(200);expect(mocks.single).not.toHaveBeenCalled();
});
it('rejects oversized streamed webhook bodies before authentication or database access',async()=>{
 const response=await webhook(new Request(origin+'/api/saas/billing/webhook',{method:'POST',body:'x'.repeat(256001)}));expect(response.status).toBe(413);expect(mocks.trustedRpc).not.toHaveBeenCalled();expect(mocks.single).not.toHaveBeenCalled();
});
it('independently verifies signed charge events and asks for a retry if reconciliation fails',async()=>{
 const body=JSON.stringify({event:'charge.success',data:{reference:ref,amount:1}}),sig=createHmac('sha512','sk_test_saas').update(body).digest('hex');
 const req=()=>new Request(origin+'/api/saas/billing/webhook',{method:'POST',body,headers:{'x-paystack-signature':sig}});
 expect((await webhook(req())).status).toBe(200);expect(mocks.trustedRpc).toHaveBeenCalledWith('saas_apply_payment',expect.objectContaining({p_amount:100000}));
 mocks.trustedRpc.mockResolvedValue({error:{message:'Database unavailable'}});expect((await webhook(req())).status).toBe(503);
});
