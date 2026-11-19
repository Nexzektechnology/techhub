import {NextResponse} from 'next/server';
import {platformIdentity} from '@/lib/platform-server';
import {guard,failure} from '@/lib/http';
import {boundedJson} from '@/lib/saas-server';
import {affiliateCommand,affiliateFilters} from '@/lib/tenant-affiliates';
type Context={params:Promise<{slug:string}>};
export async function GET(req:Request,{params}:Context){try{
 const {db}=await platformIdentity(),{slug}=await params,f=affiliateFilters.parse(Object.fromEntries(new URL(req.url).searchParams));
 const c=await db.rpc('tenant_affiliate_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const r=await db.rpc('tenant_affiliate_snapshot',{p_company:c.data.id,p_affiliate:f.affiliate||null,p_release:f.release||null,p_page:f.page});if(r.error)throw Error(r.error.message);
 return NextResponse.json(r.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:Context){try{
 guard(req);const {db}=await platformIdentity(),{slug}=await params,command=affiliateCommand.parse(await boundedJson(req,24000));
 const c=await db.rpc('tenant_affiliate_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const rate=await db.rpc('tenant_affiliate_rate_limit',{p_company:c.data.id});if(rate.error)throw Error(rate.error.message);
 const r=await db.rpc('tenant_affiliate_command',{p_company:c.data.id,p_key:command.key,p_action:command.action,p_data:command.data});if(r.error)throw Error(r.error.message);
 return NextResponse.json({ok:true,data:r.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
