import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:mocks.identity}));
import {POST} from '../src/app/api/tenant/[slug]/sync/route';
const actor='61000000-0000-4000-8000-000000000002',company='10000000-0000-4000-8000-000000000011',other='61000000-0000-4000-8000-000000000003';
const op={id:'81000000-0000-4000-8000-000000000001',command:{action:'stock',data:{warehouse_id:'warehouse-a',product_id:'product-a',delta:1,reason:'Offline stock receipt'}},expected:'absent',after:null};
const params={params:Promise.resolve({slug:'tenant-a'})};
function request(body:unknown,origin='https://bizhub.example'){return new Request('https://bizhub.example/api/tenant/tenant-a/sync',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({user:{id:actor},db:{rpc:mocks.rpc}});mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='company_context'?{data:{id:company}}:name==='tenant_sync_apply'?{data:{state:'applied',id:args.p_id}}:{data:null});});
it('derives company and actor from the authenticated session and keeps per-operation results',async()=>{
 const response=await POST(request({actor,operations:[op,{...op,id:'81000000-0000-4000-8000-000000000002',after:op.id,expected:null}]}),params);
 expect(response.status).toBe(200);const result=await response.json();expect(result.actor).toBe(actor);expect(result.company).toBe(company);expect(result.results).toHaveLength(2);
 const calls=mocks.rpc.mock.calls.filter(([name])=>name==='tenant_sync_apply');expect(calls[0][1]).toMatchObject({p_company:company,p_id:op.id,p_cancel:false});expect(calls[1][1].p_after).toBe(op.id);
});
it('rejects another account and cross-origin uploads before any queued operation runs',async()=>{
 expect((await POST(request({actor:other,operations:[op]}),params)).status).toBe(403);expect(mocks.rpc.mock.calls.some(([name])=>name==='tenant_sync_apply')).toBe(false);
 mocks.identity.mockClear();expect((await POST(request({actor,operations:[op]},'https://untrusted.example'),params)).status).toBe(400);expect(mocks.identity).not.toHaveBeenCalled();
});
it('retains auth failures and throttling as retryable responses and rejects oversized batches',async()=>{
 mocks.identity.mockRejectedValueOnce(Error('Authentication required'));expect((await POST(request({actor,operations:[op]}),params)).status).toBe(401);
 mocks.rpc.mockImplementation(async(name:string)=>name==='company_context'?{data:{id:company}}:{error:{message:'Rate limit'}});const limited=await POST(request({actor,operations:[op]}),params);expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('60');
 expect((await POST(request({actor,operations:Array.from({length:11},()=>op)}),params)).status).toBe(400);
});
