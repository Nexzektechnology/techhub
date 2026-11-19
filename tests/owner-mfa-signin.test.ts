import {expect,it,vi} from 'vitest';
const {client,redirect}=vi.hoisted(()=>({client:vi.fn(),redirect:vi.fn((p:string)=>{throw Error(p);})}));
vi.mock('@/lib/server',()=>({configured:()=>true,supabase:client}));
vi.mock('next/navigation',()=>({redirect}));
import Page from '../src/app/platform/security/page';
it('returns signed-out visitors to the security page through login before querying admin access',async()=>{
  const from=vi.fn();
  client.mockResolvedValue({auth:{getUser:async()=>({data:{user:null},error:null})},from});
  await expect(Page()).rejects.toThrow('/login?next=%2Fplatform%2Fsecurity');
  expect(from).not.toHaveBeenCalled();
});
