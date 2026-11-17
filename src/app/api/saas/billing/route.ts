import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {service} from '@/lib/server';
import {publicOrigin} from '@/lib/public-origin';
import {billingCommand,type SaasInvoice} from '@/lib/saas-contract';
import {boundedJson,saasPaystack,verifiedSaasCharge,setupVerifiedAutomaticBilling} from '@/lib/saas-server';
import {automaticBillingConfigured} from '@/lib/billing-authorization';
export async function POST(req:Request){try{
 guard(req);const {db,user}=await platformIdentity();const c=billingCommand.parse(await boundedJson(req));
 if(!process.env.SAAS_PAYSTACK_SECRET_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('SaaS billing is not configured');
 const throttle=await db.rpc('saas_rate_limit',{p_action:'billing'});if(throttle.error)throw Error(throttle.error.message);
 let invoice:SaasInvoice;
 if(c.action==='checkout'){
  if(c.automatic&&!automaticBillingConfigured())throw Error('Automatic billing is not configured');
  const r=await db.rpc('saas_create_invoice',{p_company:c.company_id,p_price:c.price_id});if(r.error)throw Error(r.error.message);invoice=r.data;
  const consent=await db.rpc('saas_autopay_intent',{p_reference:invoice.reference,p_enable:c.automatic===true,p_version:'2026-11-16'});if(consent.error)throw Error(consent.error.message);
 }else{
  const r=await db.from('saas_invoices').select('*').eq('reference',c.reference).single();if(r.error||!r.data)throw Error('Invoice unavailable');invoice=r.data;
 }
 const trusted=service();
 if(c.action==='verify'){
  const charge=await saasPaystack(`/transaction/verify/${encodeURIComponent(c.reference)}`);
  if(['failed','abandoned'].includes(charge.status)&&charge.reference===invoice.reference&&charge.amount===Number(invoice.amount_kobo)&&charge.currency===invoice.currency){
   const r=await trusted.rpc('saas_void_failed_invoice',{p_reference:invoice.reference,p_status:charge.status});if(r.error)throw Error('Payment needs reconciliation');
   return NextResponse.json({ok:true,paid:false,message:'The provider confirmed this attempt failed. You can start a new payment.'},{headers:{'Cache-Control':'private, no-store'}});
  }
  const verified=verifiedSaasCharge(charge,c.reference,invoice);const r=await trusted.rpc('saas_apply_payment',verified);if(r.error)throw Error('Payment verified; subscription needs reconciliation. Contact support with your reference.');
  await setupVerifiedAutomaticBilling(c.reference,charge);
  return NextResponse.json({ok:true,paid:true},{headers:{'Cache-Control':'private, no-store'}});
 }
 const claim=await trusted.rpc('saas_claim_initialization',{p_reference:invoice.reference});if(claim.error)throw Error(claim.error.message);
 let url=claim.data?.url;
 if(!url){
  const origin=publicOrigin(req);
  const result=await saasPaystack('/transaction/initialize',{reference:invoice.reference,amount:invoice.amount_kobo,currency:invoice.currency,email:user.email,
   callback_url:`${origin}/billing/return?reference=${encodeURIComponent(invoice.reference)}`,metadata:{purpose:'saas_subscription',invoice_id:invoice.id}});
  url=result.authorization_url;
  const saved=await trusted.rpc('saas_save_initialization',{p_reference:invoice.reference,p_url:url});if(saved.error)throw Error('Payment initialized; reconciliation required before retrying');
 }
 if(typeof url!=='string'||!/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9_-]+$/.test(url))throw Error('Invalid provider URL');
 return NextResponse.json({ok:true,url,reference:invoice.reference},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
