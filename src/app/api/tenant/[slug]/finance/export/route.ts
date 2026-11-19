import {z} from 'zod';
import {platformIdentity} from '@/lib/platform-server';
import {failure} from '@/lib/http';
import {csv} from '@/lib/business';
import {financeFilters} from '@/lib/tenant-finance';
const kinds=z.enum(['ledger','trial_balance','profit_loss','balance_sheet','cash_flow','receivables','payables']);
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 const {db}=await platformIdentity(),{slug}=await params,query=Object.fromEntries(new URL(req.url).searchParams),filters=financeFilters.parse(query),kind=kinds.parse(query.kind);
 const context=await db.rpc('company_context',{p_slug:slug});if(context.error||!context.data)throw Error('Forbidden');
 const rate=await db.rpc('tenant_operation_rate_limit',{p_company:context.data.id,p_action:'finance'});if(rate.error)throw Error(rate.error.message);
 const result=await db.rpc('tenant_finance_export',{p_company:context.data.id,p_kind:kind,p_warehouse:filters.warehouse||null,p_from:filters.from||null,p_to:filters.to||null,p_account:filters.account,p_balance:filters.balance==='1'});if(result.error)throw Error(result.error.message);
 return new Response(csv(result.data as (string|number|null)[][]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="finance-${kind}.csv"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return failure(e);}}
