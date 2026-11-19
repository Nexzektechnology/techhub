import {NextResponse} from 'next/server';
import {platformIdentity} from '@/lib/platform-server';
import {boundedJson} from '@/lib/saas-server';
import {guard,failure} from '@/lib/http';
import {financeCommand,financeFilters} from '@/lib/tenant-finance';
type Context={params:Promise<{slug:string}>};
export async function GET(req:Request,{params}:Context){try{
 const {db}=await platformIdentity(),{slug}=await params,f=financeFilters.parse(Object.fromEntries(new URL(req.url).searchParams));
 const c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const r=await db.rpc('tenant_finance_snapshot',{p_company:c.data.id,p_warehouse:f.warehouse||null,p_from:f.from||null,p_to:f.to||null,p_account:f.account,p_page:f.page,p_balance:f.balance==='1'});if(r.error)throw Error(r.error.message);
 return NextResponse.json(r.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:Context){try{
 guard(req);const {db}=await platformIdentity(),{slug}=await params,command=financeCommand.parse(await boundedJson(req,256000));
 const c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)throw Error('Forbidden');
 const rate=await db.rpc('tenant_operation_rate_limit',{p_company:c.data.id,p_action:'finance'});if(rate.error)throw Error(rate.error.message);
 const r=await db.rpc('tenant_finance_command',{p_company:c.data.id,p_key:command.key,p_action:command.action,p_data:command.data});if(r.error)throw Error(r.error.message);
 return NextResponse.json({ok:true,data:r.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
