import {beforeEach,it,expect,vi} from 'vitest';
import {exactMoney,parseBankStatement} from '../src/lib/tenant-finance';
const state=vi.hoisted(()=>({rpc:vi.fn(),identity:vi.fn()}));
vi.mock('../src/lib/platform-server',()=>({platformIdentity:state.identity}));
import {POST,GET} from '../src/app/api/tenant/[slug]/finance/route';
const context={params:Promise.resolve({slug:'tenant-a'})},key='11111111-1111-4111-8111-111111111111';
const command={key,action:'expense',data:{date:'2026-11-18',description:'Verified office electricity',amount_kobo:10000,account_code:'6000',payment_account:'1010',reference:'BANK-EXPENSE-001',confirmed:true}};
const request=(body:unknown,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/tenant/tenant-a/finance',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();state.identity.mockResolvedValue({db:{rpc:state.rpc}});state.rpc.mockImplementation(async(name:string)=>name==='company_context'?{data:{id:'company-a'}}:{data:{id:'posted'}});});
it('posts canonical finance commands to the authorized company without caching results',async()=>{
 const response=await POST(request(command),context);expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(state.rpc).toHaveBeenLastCalledWith('tenant_finance_command',{p_company:'company-a',p_key:key,p_action:'expense',p_data:command.data});
});
it('rejects unauthorized origins, unconfirmed payments, unknown tenant fields and unauthenticated writes',async()=>{
 expect((await POST(request(command,'https://hostile.example'),context)).status).toBe(400);expect(state.identity).not.toHaveBeenCalled();
 expect((await POST(request({...command,data:{...command.data,company_id:'foreign'}}),context)).status).toBe(400);expect((await POST(request({...command,data:{...command.data,confirmed:false}}),context)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 state.identity.mockRejectedValue(Error('Authentication required'));expect((await POST(request(command),context)).status).toBe(401);
});
it('preserves warehouse/date/account/source filters and refuses invalid report input',async()=>{
 const result=await GET(new Request('http://localhost:3000/api/tenant/tenant-a/finance?warehouse=main&from=2026-11-01&to=2026-11-18&account=1000&page=2&balance=1'),context);expect(result.status).toBe(200);expect(state.rpc).toHaveBeenLastCalledWith('tenant_finance_snapshot',{p_company:'company-a',p_warehouse:'main',p_from:'2026-11-01',p_to:'2026-11-18',p_account:'1000',p_page:2,p_balance:true});expect((await GET(new Request('http://localhost:3000/api/tenant/tenant-a/finance?from=not-a-date'),context)).status).toBe(400);
});
it('formats large exact balances and negative sub-naira amounts without number rounding',()=>{
 expect(exactMoney('900719925474099301')).toBe('₦9,007,199,254,740,993.01');expect(exactMoney('-1')).toBe('-₦0.01');expect(exactMoney('10000')).toBe('₦100');
});
it('parses bank-neutral quoted CSV with exact signed kobo and rejects malformed or duplicate rows',()=>{
 expect(parseBankStatement('external_id,date,amount,reference,description\n1,2026-11-18,-0.29,REF-001,"Power, office"')).toEqual([{external_id:'1',date:'2026-11-18',amount_kobo:-29,reference:'REF-001',description:'Power, office'}]);
 expect(()=>parseBankStatement('external_id,date,amount,reference,description\n1,2026-11-18,1.001,REF-001,Invalid')).toThrow('decimal');
 expect(()=>parseBankStatement('external_id,date,amount,reference,description\n1,2026-11-18,1,REF-001,Valid\n1,2026-11-18,2,REF-002,Duplicate')).toThrow('duplicate');
 expect(()=>parseBankStatement('external_id,date,amount,reference,description\n1,2026-11-18,1,REF-001,"Unclosed')).toThrow('unfinished');
});
