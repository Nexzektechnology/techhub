import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),identity:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:state.identity}));
// Keep real body bounding, schema validation and request origin checks.
import {GET,POST} from '../src/app/api/tenant/[slug]/business/route';
const context={params:Promise.resolve({slug:'company-a'})};
const key='11111111-1111-4111-8111-111111111111';
const command={key,action:'customer',data:{name:'API customer',email:'customer@example.com'}};
const request=(body:unknown,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/tenant/company-a/business',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();state.identity.mockResolvedValue({db:{rpc:state.rpc}});
 state.rpc.mockImplementation(async(name:string)=>name==='company_context'?{data:{id:'company-a'}}:name==='tenant_business_snapshot'?{data:{company_id:'company-a',customers:[]}}:{data:{id:'saved'}});
});
it('requires authentication before executing business commands',async()=>{
 state.identity.mockRejectedValue(Error('Authentication required'));
 expect((await POST(request(command),context)).status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();
});
it('rejects cross-origin writes before resolving identity or touching the database',async()=>{
 expect((await POST(request(command,'https://hostile.example'),context)).status).toBe(400);expect(state.identity).not.toHaveBeenCalled();
});
it('validates keys, unknown fields and malformed data before RPC execution',async()=>{
 for(const body of [{...command,key:'invalid'},{...command,data:{name:'x'}},{...command,data:{...command.data,company_id:'foreign'}},{...command,company_id:'foreign'}]){
  expect((await POST(request(body),context)).status).toBe(400);
 }
 expect(state.rpc).not.toHaveBeenCalled();
});
it('bounds request bodies and refuses oversized requests',async()=>{
 expect((await POST(request({...command,data:{name:'x'.repeat(17000)}}),context)).status).toBe(400);
 expect(state.rpc).not.toHaveBeenCalled();
});
it('uses the authorized company, same idempotency key and canonical validated input',async()=>{
 const result=await POST(request(command),context);expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');
 expect(state.rpc).toHaveBeenLastCalledWith('tenant_business_command',{p_company:'company-a',p_key:key,p_action:'customer',p_data:{...command.data,phone:'',address:'',notes:'',active:true}});
});
it('stops at company and rate-limit failures',async()=>{
 state.rpc.mockResolvedValueOnce({error:{message:'Forbidden'}});
 expect((await POST(request(command),context)).status).toBe(403);expect(state.rpc).toHaveBeenCalledTimes(1);
 state.rpc.mockResolvedValueOnce({data:{id:'company-a'}}).mockResolvedValueOnce({error:{message:'Rate limited'}});
 expect((await POST(request(command),context)).status).toBe(400);
 expect(state.rpc.mock.calls.some(([name])=>name==='tenant_business_command')).toBe(false);
});
it('returns authorization failures without claiming a successful save',async()=>{
 state.rpc.mockImplementation(async(name:string)=>name==='tenant_business_command'?{error:{message:'Forbidden'}}:{data:{id:'company-a'}});
 expect((await POST(request(command),context)).status).toBe(403);
});
it('validates and forwards branch/search/pagination and prevents caching private data',async()=>{
 const branch='22222222-2222-4222-8222-222222222222';
 const result=await GET(new Request(`http://localhost:3000/api/tenant/company-a/business?branch=${branch}&q=customer&page=2`),context);
 expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');
 expect(state.rpc).toHaveBeenLastCalledWith('tenant_business_snapshot',{p_company:'company-a',p_branch:branch,p_query:'customer',p_page:2});
 expect((await GET(new Request('http://localhost:3000/api/tenant/company-a/business?page=-1'),context)).status).toBe(400);
});
