import {NextResponse} from 'next/server';
import {z} from 'zod';
import {platformIdentity} from '@/lib/platform-server';
import {failure} from '@/lib/http';
export async function GET(_req:Request,{params}:{params:Promise<{slug:string;id:string}>}){try{
 const {db}=await platformIdentity(),{slug,id}=await params;z.uuid().parse(id);const company=await db.rpc('company_context',{p_slug:slug});if(company.error||!company.data)throw Error('Forbidden');
 const r=await db.rpc('tenant_finance_journal',{p_company:company.data.id,p_journal:id});if(r.error)throw Error(r.error.message);return NextResponse.json(r.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
