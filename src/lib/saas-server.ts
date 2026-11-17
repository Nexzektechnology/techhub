import 'server-only';
import {supabase,service} from './server';
import {encryptAuthorization} from './billing-authorization';
import {paymentOrigin} from './payment-origin';
import {boundedText} from './request-body';
import {platformIdentity} from './platform-server';
import {validSignature,verifiedCharge} from './paystack';
import type {SaasInvoice,SaasPlan,SaasPortal,SaasPrice,SaasOverview} from './saas-contract';

export async function saasCatalog(){
 const db=await supabase();const [plans,prices]=await Promise.all([
  db.from('saas_plans').select('*').eq('available',true).order('employee_limit'),
  db.from('saas_prices').select('*').eq('available',true).order('months'),
 ]);if(plans.error||prices.error)throw Error('Plans are temporarily unavailable');
 return {plans:(plans.data||[]) as SaasPlan[],prices:(prices.data||[]) as SaasPrice[]};
}
export async function saasPortal(slug:string):Promise<SaasPortal>{const {db}=await platformIdentity();const r=await db.rpc('saas_portal',{p_slug:slug});if(r.error)throw Error('Company settings unavailable or access denied');return r.data;}
export async function saasOverview(page:number):Promise<SaasOverview>{const {db}=await platformIdentity();const r=await db.rpc('saas_platform_overview',{p_page:page});if(r.error)throw Error('Platform administrator with verified MFA required');return r.data;}
export async function saasPaystack(path:string,body?:unknown){
 const secret=process.env.SAAS_PAYSTACK_SECRET_KEY;
 if(!secret)throw Error('SaaS billing is not configured');
 const response=await fetch(`${paymentOrigin(secret)}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const json=await response.json();if(!response.ok||!json.status)throw Error('Subscription payment provider unavailable');return json.data;
}
export function validSaasSignature(body:string,signature:string){const secret=process.env.SAAS_PAYSTACK_SECRET_KEY;return !!secret&&validSignature(body,signature,secret);}
export async function setupVerifiedAutomaticBilling(reference:string,charge:{authorization?:{authorization_code?:string;reusable?:boolean};customer?:{email?:string}}){
 const db=service();const context=await db.rpc('saas_autopay_setup_context',{p_reference:reference});if(context.error)throw Error('Automatic billing setup requires reconciliation');
 if(!context.data?.company_id)return;
 const {company_id:company,email}=context.data;
 if(!charge.authorization?.reusable||!charge.authorization.authorization_code||charge.customer?.email?.toLowerCase()!==email){const r=await db.rpc('saas_autopay_unavailable',{p_reference:reference});if(r.error)throw Error('Automatic billing setup requires reconciliation');return;}
 const ciphertext=encryptAuthorization(charge.authorization.authorization_code,company);const saved=await db.rpc('saas_save_autopay',{p_reference:reference,p_ciphertext:ciphertext,p_email:email});if(saved.error)throw Error('Automatic billing setup requires reconciliation');
}
export async function verifySaasCharge(reference:string,invoice:Pick<SaasInvoice,'amount_kobo'>){
 const data=await saasPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
 return verifiedSaasCharge(data,reference,invoice);
}
export function verifiedSaasCharge(data:{reference:string;amount:number;currency:string;status:string;id:string|number},reference:string,invoice:Pick<SaasInvoice,'amount_kobo'>){
 verifiedCharge(data,reference,Number(invoice.amount_kobo));
 // Provider IDs must retain exact integer identity, including on large accounts.
 if(!((typeof data.id==='number'&&Number.isSafeInteger(data.id)&&data.id>0)||(typeof data.id==='string'&&/^[0-9]{1,30}$/.test(data.id))))throw Error('Invalid provider transaction identity');
 return {p_reference:reference,p_amount:data.amount,p_currency:data.currency,p_status:data.status,p_provider_id:String(data.id)};
}
export async function boundedJson(req:Request,limit=16000):Promise<unknown>{
 return JSON.parse(await boundedText(req,limit));
}
