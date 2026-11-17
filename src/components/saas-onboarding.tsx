'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Building2,Check,ArrowRight} from 'lucide-react';
import {money,cycleName,type SaasPlan,type SaasPrice} from '@/lib/saas-contract';
export function SaasOnboarding({plans,prices,email}:{plans:SaasPlan[];prices:SaasPrice[];email:string}){
 const [selected,setSelected]=useState(plans[0]?.id||'');const [name,setName]=useState('');const [primary,setPrimary]=useState('#2457C5');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const router=useRouter();
 return <main className="platform-root platform-main saas-main"><header className="saas-heading"><Link href="/workspaces">← Your workspaces</Link><span className="eyebrow">A WORKSPACE FOR YOUR BUSINESS</span><h1>Your company.<br/>Room to grow.</h1><p>Choose your plan and set up an independent company workspace.</p></header>
 {!plans.length?<section className="platform-panel"><h2>Registration is opening soon.</h2><p>Company plans are being configured. Existing workspaces remain available.</p><Link href="/workspaces" className="button">Open your workspaces</Link></section>:
 <form onSubmit={async e=>{
  e.preventDefault();setBusy(true);setMessage('');const f=new FormData(e.currentTarget);
  try{
   let key=sessionStorage.getItem('saas-registration-key');if(!key){key=crypto.randomUUID();sessionStorage.setItem('saas-registration-key',key);}
   const r=await fetch('/api/saas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,name,slug:f.get('slug'),plan_id:selected,registration_number:f.get('registration_number'),category:f.get('category'),address:f.get('address'),email:f.get('email'),phone:f.get('phone'),primary})});
   const d=await r.json();if(!r.ok)throw Error(d.error);sessionStorage.removeItem('saas-registration-key');router.push(d.redirect);router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'Registration failed. Try again.');}finally{setBusy(false);}
 }}>
 <fieldset className="saas-plan-picker"><legend>1. Choose your plan</legend><div className="saas-plan-grid">{plans.map(p=><label className="saas-plan-card" data-selected={selected===p.id} key={p.id}>
  <span className="saas-choice"><input name="plan" type="radio" checked={selected===p.id} onChange={()=>setSelected(p.id)}/>{p.name}</span><p>{p.description}</p>
  <strong>{prices.filter(v=>v.plan_id===p.id).length?money(Math.min(...prices.filter(v=>v.plan_id===p.id).map(v=>v.amount_kobo/v.months)))+' / month equivalent':'Payment terms pending'}</strong>
  <span><Check size={15}/>{p.employee_limit} employees</span><span><Check size={15}/>{Math.round(p.storage_bytes/1048576)} MB storage</span><span><Check size={15}/>{p.trial_days?`${p.trial_days}-day trial`:'Payment required to activate'}</span>
  {prices.filter(v=>v.plan_id===p.id).map(v=><small key={v.id}>{cycleName(v.months)} · {money(v.amount_kobo)}</small>)}
 </label>)}</div></fieldset>
 <div className="platform-grid"><section className="platform-panel"><h2>2. Company details</h2>
 <label>Company name<input name="name" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={100} required autoComplete="organization"/></label>
 <label>Workspace slug<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={60} placeholder="your-company" required/><small>/company/your-company</small></label>
 <div className="platform-form-row"><label>Registration number<input name="registration_number" maxLength={100}/></label><label>Business category<input name="category" maxLength={100} placeholder="Retail, distribution…" minLength={2} required/></label></div>
 <label>Company address<textarea name="address" maxLength={500} autoComplete="street-address"/></label>
 <div className="platform-form-row"><label>Business email<input name="email" type="email" defaultValue={email} required/></label><label>Phone<input name="phone" maxLength={40} autoComplete="tel"/></label></div>
 </section><section className="platform-panel"><h2>3. Make it yours</h2><label>Primary colour<input type="color" value={primary} onChange={e=>setPrimary(e.target.value)}/></label>
 <div className="saas-brand-preview" style={{borderColor:primary}}><Building2 color={primary} size={36}/><h3>{name||'Your company'}</h3><span style={{background:primary,color:'#fff'}}>Your workspace</span></div>
 <p>Your workspace includes the modules configured for your selected plan. Set up your catalogue, locations and verified settlement account before opening checkout.</p><p>Your company administrator account: <strong>{email}</strong></p>
 {message&&<p className="info-message" role="alert">{message}</p>}<button className="button" disabled={busy||!selected}>{busy?'Creating your company…':'Create company workspace'}<ArrowRight size={17}/></button>
 <p className="help-text">No card is collected here. Any required payment happens through Paystack from your company settings.</p></section></div>
 </form>}</main>;
}
