import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {boundedJson} from '@/lib/saas-server';
import {tenantCommand} from '@/lib/tenant-commerce';
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 guard(req);const {db}=await platformIdentity();const {slug}=await params;const command=tenantCommand.parse(await boundedJson(req,30000));
 const company=await db.rpc('company_context',{p_slug:slug});if(company.error||!company.data)throw Error('Forbidden');
 const limited=await db.rpc('saas_rate_limit',{p_action:'settings'});if(limited.error)throw Error(limited.error.message);
 const r=await db.rpc('tenant_commerce_command',{p_company:company.data.id,p_action:command.action,p_data:command.data});if(r.error)throw Error(r.error.message);
 return NextResponse.json({ok:true,data:r.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
