import {NextResponse} from 'next/server';
import {platformIdentity} from '@/lib/platform-server';
import {guard,failure} from '@/lib/http';
import {boundedJson} from '@/lib/saas-server';
import {offlineBatch} from '@/lib/offline-contract';
const headers={'Cache-Control':'private, no-store'};
async function context(slug:string){const {db,user}=await platformIdentity();const r=await db.rpc('company_context',{p_slug:slug});if(r.error||!r.data)throw Error('Forbidden');return {db,user,company:r.data};}
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 const {slug}=await params,{db,user,company}=await context(slug);const page=Number(new URL(req.url).searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)throw Error('Invalid page');
 const r=await db.rpc('tenant_offline_snapshot',{p_company:company.id,p_page:page});if(r.error)throw Error(r.error.message);
 return NextResponse.json({...r.data,actor:user.id,slug,name:company.name,savedAt:new Date().toISOString()},{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 guard(req);const {slug}=await params,{db,user,company}=await context(slug);const input=offlineBatch.parse(await boundedJson(req,310000));if(input.actor!==user.id)throw Error('Forbidden');
 const limit=await db.rpc('saas_rate_limit',{p_action:'settings'});if(limit.error)return NextResponse.json({error:'Sync is paused briefly. Your saved work is retained.'},{status:429,headers:{...headers,'Retry-After':'60'}});
 const results=[];for(const item of input.operations){const r=await db.rpc('tenant_sync_apply',{p_company:company.id,p_id:item.id,p_action:item.command.action,p_data:item.command.data,p_expected:item.expected,p_after:item.after,p_cancel:item.cancel===true});results.push(r.error?{id:item.id,state:'review',error:r.error.message}:{...r.data,id:item.id});}
 return NextResponse.json({actor:user.id,company:company.id,results},{headers});
}catch(e){return failure(e);}}
