'use client';
import {useState} from 'react';
import Link from 'next/link';
export function SaasPaymentReturn({reference}:{reference:string}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[paid,setPaid]=useState(false);
 return <main className="platform-root platform-locked"><span className="eyebrow">SUBSCRIPTION PAYMENT</span><h1>{paid?'Payment verified.':'Let’s verify your payment.'}</h1><p>Subscription access changes only after the payment provider and database confirm the reference, amount and currency.</p><code>{reference}</code>
 {message&&<p className="info-message" role="status">{message}</p>}{!paid&&<button className="button" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{const r=await fetch('/api/saas/billing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',reference})});const d=await r.json();if(!r.ok)throw Error(d.error);setPaid(d.paid===true);setMessage(d.message||'Your subscription period has been updated.');}catch(e){setMessage(e instanceof Error?e.message:'Verification unavailable');}finally{setBusy(false);}}}>{busy?'Checking…':'Verify payment'}</button>}
 <Link href="/workspaces">Your company workspaces</Link><Link href={`/login?next=${encodeURIComponent(`/billing/return?reference=${reference}`)}`}>Sign in to verify</Link></main>;
}
