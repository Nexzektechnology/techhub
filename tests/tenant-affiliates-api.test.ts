import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:state.identity}));
import {GET,POST} from '../src/app/api/tenant/[slug]/affiliates/route';
const context={params:Promise.resolve({slug:'partner-company'})},key='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
const request=(data:unknown,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/tenant/partner-company/affiliates',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();state.identity.mockResolvedValue({db:{rpc:state.rpc}});state.rpc.mockImplementation(async(name:string)=>name==='tenant_affiliate_context'?{data:{id:'company-a'}}:{data:{id:'recorded'}});});
it('resolves recipient access on the server and preserves the keyed declaration without a company selector',async()=>{
 const data={release_id:rid,quantity:2,note:'Unsold stock declared for physical inspection'};const result=await POST(request({key,action:'return-declare',data}),context);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('private, no-store');expect(state.rpc).toHaveBeenLastCalledWith('tenant_affiliate_command',{p_company:'company-a',p_key:key,p_action:'return-declare',p_data:data});
});
it('refuses untrusted origins, tenant overrides, unverified inspection and unconfirmed money',async()=>{
 expect((await POST(request({},'https://hostile.example'),context)).status).toBe(400);expect(state.identity).not.toHaveBeenCalled();
 const inspection={key,action:'inspect',data:{release_id:rid,declaration_id:key,quantity:1,verified:false,disposition:'resellable',note:'The declared goods were never physically inspected'}};expect((await POST(request(inspection),context)).status).toBe(400);
 expect((await POST(request({key,action:'remit',data:{release_id:rid,amount_kobo:100,confirmed:false,payment_account:'1010',reference:'REFERENCE-001'}}),context)).status).toBe(400);
 expect((await POST(request({key,action:'return-declare',data:{release_id:rid,quantity:1,note:'Declared but not inspected return',company_id:'other'}}),context)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
});
it('preserves account/release pagination and denies inaccessible recipient context',async()=>{
 const response=await GET(new Request(`http://localhost:3000/api/tenant/partner-company/affiliates?affiliate=${key}&release=${rid}&page=2`),context);expect(response.status).toBe(200);expect(state.rpc).toHaveBeenLastCalledWith('tenant_affiliate_snapshot',{p_company:'company-a',p_affiliate:key,p_release:rid,p_page:2});
 state.rpc.mockResolvedValue({error:{message:'Forbidden'}});expect((await GET(new Request('http://localhost:3000/api/tenant/partner-company/affiliates'),context)).status).toBe(403);
});
