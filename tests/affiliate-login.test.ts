import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),login:vi.fn(),profile:vi.fn()}));
vi.mock('../src/lib/server',()=>({configured:()=>true,supabase:async()=>({auth:{signInWithPassword:state.login},rpc:state.rpc,from:()=>({select:()=>({eq:()=>({single:state.profile})})})})}));
import {POST} from '../src/app/api/auth/route';
const request=()=>new Request('http://localhost:3000/api/auth',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({action:'login',email:'partner@example.com',password:'test-partner-password'})});
beforeEach(()=>{vi.clearAllMocks();state.login.mockResolvedValue({data:{session:{},user:{id:'verified-account'}},error:null});state.profile.mockResolvedValue({data:{role:'customer'}});state.rpc.mockResolvedValue({data:null,error:null});});
it('routes a verified stock partner to authorized workspaces while retaining ordinary customer destinations',async()=>{
 state.rpc.mockImplementation(async(name:string)=>({data:name==='my_affiliate_workspaces'?[{slug:'partner-company'}]:null,error:null}));expect((await(await POST(request())).json()).redirect).toBe('/workspaces');
 state.rpc.mockResolvedValue({data:null,error:null});expect((await(await POST(request())).json()).redirect).toBe('/account');
});
it('does not let optional partner metadata failures break customer sign-in or override staff destinations',async()=>{
 state.rpc.mockImplementation(async(name:string)=>name==='my_affiliate_workspaces'?{error:{message:'Temporarily unavailable'}}:{data:null,error:null});expect((await(await POST(request())).json()).redirect).toBe('/account');
 state.profile.mockResolvedValue({data:{role:'admin'}});expect((await(await POST(request())).json()).redirect).toBe('/admin');
});
