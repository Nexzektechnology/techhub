import {NextResponse} from 'next/server';
import {z} from 'zod';
import {guard,failure} from '@/lib/http';
import {supabase} from '@/lib/server';
import {boundedJson} from '@/lib/saas-server';
import {verifyTenantPayment} from '@/lib/tenant-server';
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 guard(req);const {slug}=await params;const {reference}=z.object({reference:z.string().regex(/^edge-tenant-[0-9a-f-]{36}$/)}).strict().parse(await boundedJson(req));
 const db=await supabase();const order=await db.rpc('tenant_my_order',{p_slug:slug,p_reference:reference});if(order.error||!order.data)throw Error('Forbidden');
 const limit=await db.rpc('saas_rate_limit',{p_action:'billing'});if(limit.error)throw Error(limit.error.message);
 return NextResponse.json({ok:true,order:await verifyTenantPayment(reference)},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
