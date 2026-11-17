import 'server-only';
import {service} from './server';
import {saasPaystack,verifiedSaasCharge} from './saas-server';
import {decryptAuthorization,automaticBillingConfigured} from './billing-authorization';
type ChargeJob={id:string;lease:string;company_id:string;reference:string;amount:number;currency:string;submit:boolean;email:string;ciphertext:string;created_at:string};
export async function runBillingWorker(){
 const db=service();const expired=await db.rpc('tenant_expire_pending');if(expired.error)throw Error('Inventory expiry unavailable');
 if(!automaticBillingConfigured()){const beat=await db.rpc('saas_worker_heartbeat',{p_detail:{automatic_billing_paused:true,expired:expired.data}});if(beat.error)throw Error('Worker heartbeat unavailable');return {processed:0,automatic_billing_paused:true};}
 const queued=await db.rpc('saas_enqueue_renewals');if(queued.error)throw Error('Renewal scheduling unavailable');
 const jobs=await db.rpc('saas_claim_charge_jobs',{p_limit:5});if(jobs.error)throw Error('Billing queue unavailable');
 const outcomes=await Promise.all((jobs.data as ChargeJob[]||[]).map(async job=>{
  let outcome='pending',error='';
  try{
   if(job.submit){
    // A leased invoice reference is submitted once. Any subsequent execution only verifies.
    await saasPaystack('/transaction/charge_authorization',{authorization_code:decryptAuthorization(job.ciphertext,job.company_id),email:job.email,amount:job.amount,currency:job.currency,reference:job.reference});
   }
   const charge=await saasPaystack(`/transaction/verify/${encodeURIComponent(job.reference)}`);
   if(charge.reference!==job.reference||charge.amount!==Number(job.amount)||charge.currency!==job.currency)throw Error('mismatch');
   if(charge.status==='success'){
    const verified=verifiedSaasCharge(charge,job.reference,{amount_kobo:Number(job.amount)});const applied=await db.rpc('saas_apply_payment',verified);if(applied.error)throw Error('reconciliation');outcome='paid';
   }else if(['failed','abandoned'].includes(charge.status))outcome=charge.status;
   else error='provider-pending';
  }catch{error='provider-or-reconciliation-unavailable';}
  if(outcome==='pending'&&Date.now()-new Date(job.created_at).getTime()>86400000)outcome='review';
  const finished=await db.rpc('saas_finish_charge_job',{p_id:job.id,p_lease:job.lease,p_outcome:outcome,p_error:error});
  return {id:job.id,outcome:finished.error?'lease-or-reconciliation-required':outcome};
 }));
 const heartbeat=await db.rpc('saas_worker_heartbeat',{p_detail:{processed:outcomes.length,expired:expired.data}});if(heartbeat.error)throw Error('Worker heartbeat unavailable');
 return {processed:outcomes.length,outcomes};
}
