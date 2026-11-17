import {NextResponse} from 'next/server';
import {service} from '@/lib/server';
import {boundedJson,validSaasSignature,saasPaystack,verifiedSaasCharge,setupVerifiedAutomaticBilling} from '@/lib/saas-server';
import {boundedText,RequestBodyTooLarge} from '@/lib/request-body';
export async function POST(req:Request){
 // Authenticate the exact bytes before parsing. A separate endpoint/key preserves legacy billing.
 let raw:string;try{raw=await boundedText(req,256000);}catch(e){return new NextResponse('Invalid body',{status:e instanceof RequestBodyTooLarge?413:400});}
 if(!validSaasSignature(raw,req.headers.get('x-paystack-signature')||''))return new NextResponse('Invalid signature',{status:401});
 try{
  const event=await boundedJson(new Request(req.url,{method:'POST',body:raw}),256000);
  if(!event||typeof event!=='object'||!('event' in event))return new NextResponse('Invalid event',{status:400});
  const e=event as {event:string;data?:{reference?:unknown}};
  if(e.event!=='charge.success')return NextResponse.json({received:true});
  const ref=e.data?.reference;if(typeof ref!=='string'||!/^edge-saas-[0-9a-f-]{36}$/.test(ref))return NextResponse.json({received:true});
  const trusted=service();const invoice=await trusted.from('saas_invoices').select('*').eq('reference',ref).single();
  if(invoice.error||!invoice.data)throw Error('Invoice not found');
  const charge=await saasPaystack(`/transaction/verify/${encodeURIComponent(ref)}`);const args=verifiedSaasCharge(charge,ref,invoice.data);const r=await trusted.rpc('saas_apply_payment',args);if(r.error)throw Error('Reconciliation required');await setupVerifiedAutomaticBilling(ref,charge);
  return NextResponse.json({received:true});
 }catch{return new NextResponse('Retry required',{status:503});}
}
