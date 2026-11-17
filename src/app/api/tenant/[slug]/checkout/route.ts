import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {supabase,service} from '@/lib/server';
import {checkoutSchema} from '@/lib/validation';
import {boundedJson} from '@/lib/saas-server';
import {paystack} from '@/lib/paystack';
import {publicOrigin} from '@/lib/public-origin';
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){try{
 guard(req);if(!process.env.PAYSTACK_SECRET_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Checkout is not configured');
 const {slug}=await params;const db=await supabase();const identity=await db.auth.getUser();if(identity.error||!identity.data.user||identity.data.user.is_anonymous||!identity.data.user.email_confirmed_at)throw Error('Authentication required');
 const input=checkoutSchema.strict().parse(await boundedJson(req,20000));const limit=await db.rpc('saas_rate_limit',{p_action:'billing'});if(limit.error)throw Error(limit.error.message);
 const created=await db.rpc('tenant_checkout',{p_slug:slug,p_input:input});if(created.error)throw Error(created.error.message);const order=created.data;
 if(order.payment_status==='paid')return NextResponse.json({order},{headers:{'Cache-Control':'private, no-store'}});
 const trusted=service();const context=await trusted.rpc('tenant_payment_context',{p_reference:order.reference});if(context.error||!context.data)throw Error('Payment account unavailable');
 const claim=await trusted.rpc('tenant_claim_initialization',{p_reference:order.reference});if(claim.error)throw Error(claim.error.message);let url=claim.data?.url;
 if(!url){const payment=await paystack('/transaction/initialize',{email:identity.data.user.email,reference:order.reference,amount:order.total_kobo,currency:'NGN',subaccount:context.data.subaccount,transaction_charge:0,bearer:'subaccount',callback_url:`${publicOrigin(req)}/store/${slug}/confirmation?reference=${order.reference}`,metadata:{company_id:order.company_id,order_id:order.id,purpose:'tenant_checkout'}});url=payment.authorization_url;
  const saved=await trusted.rpc('tenant_save_initialization',{p_reference:order.reference,p_url:url});if(saved.error)throw Error('Initialized payment requires reconciliation before retry');}
 if(typeof url!=='string'||!/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9_-]+$/.test(url))throw Error('Invalid payment provider URL');
 return NextResponse.json({order,url},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
