import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),identity:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:state.identity}));
import {POST,GET} from '../src/app/api/tenant/[slug]/pos/route';
const key='11111111-1111-4111-8111-111111111111',context={params:Promise.resolve({slug:'tenant-a'})};
const payload={key,action:'sale',data:{warehouse_id:'warehouse',session_id:key,items:[{product_id:'product',quantity:1,expected_price_kobo:10000}],tenders:[{method:'cash',amount_kobo:10000,received:true}]}};
const request=(body:unknown,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/tenant/tenant-a/pos',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();state.identity.mockResolvedValue({db:{rpc:state.rpc}});state.rpc.mockImplementation(async(name:string)=>name==='company_context'?{data:{id:'authorized-company'}}:{data:{id:'sale'}});});
it('uses the resolved tenant and canonical input for a keyed sale',async()=>{
 const r=await POST(request(payload),context);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');
 expect(state.rpc).toHaveBeenLastCalledWith('tenant_pos_command',{p_company:'authorized-company',p_key:key,p_action:'sale',p_data:{...payload.data,channel:'pos',approval_note:'',items:[{...payload.data.items[0],options:{}}],tenders:[{...payload.data.tenders[0],reference:''}]}});
});
it('rejects foreign origins, missing identity, spoofed company fields and unconfirmed tender',async()=>{
 expect((await POST(request(payload,'https://hostile.example'),context)).status).toBe(400);expect(state.identity).not.toHaveBeenCalled();
 expect((await POST(request({...payload,data:{...payload.data,company_id:'foreign'}}),context)).status).toBe(400);
 expect((await POST(request({...payload,data:{...payload.data,tenders:[{method:'cash',amount_kobo:10000,received:false}]}}),context)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 state.identity.mockRejectedValue(Error('Authentication required'));expect((await POST(request(payload),context)).status).toBe(401);
});
it('propagates database authorization and failed writes as errors',async()=>{
 state.rpc.mockImplementation(async(name:string)=>name==='tenant_pos_command'?{error:{message:'Forbidden'}}:{data:{id:'authorized-company'}});
 expect((await POST(request(payload),context)).status).toBe(403);
});
it('bounds read filters and keeps private sales snapshots uncached',async()=>{
 const result=await GET(new Request('http://localhost:3000/api/tenant/tenant-a/pos?warehouse=main&q=rice&page=2'),context);expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');
 expect(state.rpc).toHaveBeenLastCalledWith('tenant_pos_snapshot',{p_company:'authorized-company',p_warehouse:'main',p_query:'rice',p_page:2});
 expect((await GET(new Request('http://localhost:3000/api/tenant/tenant-a/pos?page=-1'),context)).status).toBe(400);
});
