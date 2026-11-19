import {NextResponse} from 'next/server';
import {z} from 'zod';
import {platformIdentity} from '@/lib/platform-server';
import {failure} from '@/lib/http';
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 const key=z.uuid().parse(new URL(req.url).searchParams.get('key')),{db}=await platformIdentity(),{slug}=await params;
 const company=await db.rpc('company_context',{p_slug:slug});if(company.error||!company.data)throw Error('Forbidden');
 const r=await db.rpc('tenant_pos_command_status',{p_company:company.data.id,p_key:key});if(r.error)throw Error(r.error.message);
 return NextResponse.json(r.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
