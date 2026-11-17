import 'server-only';
import {supabase,service} from './server';
import {paystack,verifiedCharge} from './paystack';
import {themeSchema} from './theme';
import type {TenantCommerce,TenantStorefront} from './tenant-commerce';
import {cache} from 'react';
export async function tenantCommerce(slug:string,page=1){
 const db=await supabase();const company=await db.rpc('company_context',{p_slug:slug});if(company.error)throw Error('Company membership required');
 const result=await db.rpc('tenant_commerce_snapshot',{p_company:company.data.id,p_page:page});if(result.error)throw Error('Commerce workspace unavailable or access denied');
 return {company:company.data,snapshot:result.data as TenantCommerce};
}
const storefrontData=cache(async(slug:string,query:string,page:number,product:string|null):Promise<TenantStorefront>=>{
 const r=await(await supabase()).rpc('tenant_storefront',{p_slug:slug,p_query:query,p_page:page,p_product:product});if(r.error||!r.data)throw Error('Store unavailable');
 const brand=themeSchema.parse(r.data.company.brand);return {...r.data,company:{...r.data.company,brand}};
});
export async function tenantStorefront(slug:string,query='',page=1,product:string|null=null){return storefrontData(slug,query,page,product);}
export async function verifyTenantPayment(reference:string){
 if(!/^edge-tenant-[0-9a-f-]{36}$/.test(reference))throw Error('Invalid payment reference');
 const db=service(),context=await db.rpc('tenant_payment_context',{p_reference:reference});if(context.error||!context.data)throw Error('Unknown tenant payment');
 const charge=await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);verifiedCharge(charge,reference,Number(context.data.amount));
 if((typeof charge.id!=='number'||!Number.isSafeInteger(charge.id)||charge.id<=0)&&!(typeof charge.id==='string'&&/^[0-9]{1,30}$/.test(charge.id)))throw Error('Provider identity mismatch');
 // Verify the business receiving the charge, as well as the amount and reference.
 const subaccount=typeof charge.subaccount==='string'?charge.subaccount:charge.subaccount?.subaccount_code;
 if(subaccount!==context.data.subaccount)throw Error('Settlement account verification mismatch');
 const applied=await db.rpc('tenant_apply_payment',{p_reference:reference,p_amount:charge.amount,p_currency:charge.currency,p_status:charge.status,p_provider:String(charge.id)});if(applied.error)throw Error('Verified payment requires reconciliation');return applied.data;
}
