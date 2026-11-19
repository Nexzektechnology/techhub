import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {boundedJson} from '@/lib/saas-server';
import {posCommand,posFilters} from '@/lib/tenant-pos';
type Context={params:Promise<{slug:string}>};
export async function GET(req:Request,{params}:Context){try{
 const {db}=await platformIdentity(),{slug}=await params,f=posFilters.parse(Object.fromEntries(new URL(req.url).searchParams));
 const c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const r=await db.rpc('tenant_pos_snapshot',{p_company:c.data.id,p_warehouse:f.warehouse||null,p_query:f.q,p_page:f.page});if(r.error)throw Error(r.error.message);
 return NextResponse.json(r.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:Context){try{
 guard(req);const {db}=await platformIdentity(),{slug}=await params,command=posCommand.parse(await boundedJson(req,64000));
 const c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const limited=await db.rpc('tenant_operation_rate_limit',{p_company:c.data.id,p_action:'pos'});if(limited.error)throw Error(limited.error.message);
 const r=await db.rpc('tenant_pos_command',{p_company:c.data.id,p_key:command.key,p_action:command.action,p_data:command.data});if(r.error)throw Error(r.error.message);
 return NextResponse.json({ok:true,data:r.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
