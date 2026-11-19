'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {PosCommand,PosSale} from '@/lib/tenant-pos';
import {enqueueSale,listQueuedSales,posQueueScope,updateQueuedSale,withPosQueueLock,type QueuedSale} from '@/lib/pos-offline';

export function usePosOffline(slug:string,actor:string){
 const router=useRouter(),scope=posQueueScope(slug,actor),[entries,setEntries]=useState<QueuedSale[]>([]),[error,setError]=useState(''),[syncing,setSyncing]=useState(false),[readyScope,setReadyScope]=useState('');
 const refresh=useCallback(async()=>{try{setEntries(await listQueuedSales(scope));setError('');setReadyScope(scope);}catch(e){setError(e instanceof Error?e.message:'Unable to read the local queue.');setReadyScope('');}},[scope]);
 const send=useCallback(async(row:QueuedSale):Promise<PosSale|null>=>{
  let response:Response;
  try{response=await fetch(`/api/tenant/${slug}/pos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row.command),signal:AbortSignal.timeout(20000)});}catch{await updateQueuedSale(row,{status:'pending',error:'Connection interrupted; this transaction will be retried with the same reference.'});return null;}
  let result:{error?:string;data?:PosSale};try{result=await response.json();}catch{await updateQueuedSale(row,{status:'pending',error:'The server response was incomplete. Retry to safely check this transaction.'});return null;}
  if(!response.ok){const message=result.error||'The transaction requires review.';await updateQueuedSale(row,{status:response.status>=500||response.status===429?'pending':'review',error:message});return null;}
  if(!result.data?.id){await updateQueuedSale(row,{status:'pending',error:'No confirmed sale identity was returned. Retry this reference.'});return null;}
  await updateQueuedSale(row,{status:'confirmed',error:undefined,reference:result.data.reference});return result.data;
 },[slug]);
 const submit=useCallback(async(command:Extract<PosCommand,{action:'sale'}>)=>withPosQueueLock(scope,async()=>{
  if(!navigator.onLine&&(!command.data.expected_total_kobo||command.data.tenders.some(t=>t.method!=='cash')||command.data.tenders.reduce((n,t)=>n+t.amount_kobo,0)!==command.data.expected_total_kobo))throw Error('During an interruption, record fully paid cash sales only. Credit, transfers and terminal confirmations require a connection.');
  const row=await enqueueSale(scope,command);await refresh();
  if(row.status==='confirmed')throw Error('This local sale is already confirmed. Check Sales & receivables.');
  if(!navigator.onLine)return {queued:true as const};
  const sale=await send(row);await refresh();if(sale){router.refresh();return {queued:false as const,sale};}
  const current=(await listQueuedSales(scope)).find(r=>r.id===row.id);if(current?.status==='review')throw Error(current.error||'This saved transaction requires review in the synchronization queue.');return {queued:true as const};
 }),[scope,refresh,router,send]);
 const synchronize=useCallback(async(key?:string)=>{if(!navigator.onLine){setError('Reconnect before synchronizing queued sales.');return;}setSyncing(true);try{
  await withPosQueueLock(scope,async()=>{const rows=await listQueuedSales(scope);let changed=false;for(const row of rows.filter(r=>key?r.command.key===key&&(r.status==='review'||r.status==='pending'):r.status==='pending')){const sale=await send(row);if(sale)changed=true;else if(!navigator.onLine)break;}if(changed)router.refresh();});await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Unable to synchronize. Original records are retained.');}finally{setSyncing(false);}},[scope,send,router,refresh]);
 const cancel=useCallback(async(row:QueuedSale)=>{setSyncing(true);try{await withPosQueueLock(scope,async()=>{
  const response=await fetch(`/api/tenant/${slug}/pos/status?key=${encodeURIComponent(row.command.key)}`,{cache:'no-store'}),result=await response.json();if(!response.ok)throw Error(result.error||'Unable to check the original transaction.');
  if(result.committed){await updateQueuedSale(row,{status:'confirmed',reference:result.reference,error:undefined});router.refresh();}
  else await updateQueuedSale(row,{status:'cancelled',error:'Cancelled after the server confirmed that this reference had not been posted. Reconcile any locally collected cash separately.'});
 });await refresh();}catch(e){setError(e instanceof Error?e.message:'Connect to verify the server result before cancelling.');}finally{setSyncing(false);}},[scope,slug,router,refresh]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0);const online=()=>void synchronize();window.addEventListener('online',online);const interval=setInterval(()=>{if(navigator.onLine)void synchronize();},30000);return()=>{clearTimeout(initial);window.removeEventListener('online',online);clearInterval(interval);};},[refresh,synchronize]);
 const current=entries.filter(r=>r.scope===scope);
 return {entries:current,error,syncing,ready:readyScope===scope,submit,synchronize,cancel,pending:current.filter(r=>r.status==='pending'||r.status==='review')};
}
