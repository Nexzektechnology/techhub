import {posCommand,type PosCommand} from './tenant-pos';
export type QueuedSale={id:string;scope:string;created:number;updated:number;status:'pending'|'review'|'confirmed'|'cancelled';command:Extract<PosCommand,{action:'sale'}>;error?:string;reference?:string};
type EncryptedRecord=Pick<QueuedSale,'id'|'scope'|'created'|'updated'|'status'>&{iv:ArrayBuffer;cipher:ArrayBuffer};
const databaseName='bizhub-pos-queue-v1';
const authenticatedMetadata=(row:Pick<QueuedSale,'id'|'scope'|'created'|'updated'|'status'>)=>new TextEncoder().encode(JSON.stringify([row.id,row.scope,row.created,row.updated,row.status]));
function request<T>(r:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Local storage request failed'));});}
function complete(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Local storage transaction aborted'));tx.onerror=()=>reject(tx.error||Error('Local storage transaction failed'));});}
async function database(){
 if(!globalThis.indexedDB||!globalThis.crypto?.subtle)throw Error('Secure local storage is unavailable. Use a supported browser over HTTPS before recording a sale.');
 const opening=indexedDB.open(databaseName,1);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('keys',{keyPath:'scope'});const records=db.createObjectStore('sales',{keyPath:'id'});records.createIndex('scope','scope',{unique:false});};
 return request(opening);
}
async function readKey(db:IDBDatabase,scope:string){const tx=db.transaction('keys','readonly');const result=await request(tx.objectStore('keys').get(scope));return result?.key as CryptoKey|undefined;}
async function encryptionKey(db:IDBDatabase,scope:string){
 const existing=await readKey(db,scope);if(existing)return existing;
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const tx=db.transaction('keys','readwrite'),finished=complete(tx);tx.objectStore('keys').add({scope,key});
 try{await finished;return key;}catch(error){const winner=await readKey(db,scope);if(winner)return winner;throw error;}
}
export const posQueueScope=(slug:string,actor:string)=>JSON.stringify([slug,actor]);
async function encode(db:IDBDatabase,row:QueuedSale):Promise<EncryptedRecord>{
 const key=await encryptionKey(db,row.scope),iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:authenticatedMetadata(row)},key,new TextEncoder().encode(JSON.stringify({command:row.command,error:row.error,reference:row.reference})));
 return {id:row.id,scope:row.scope,created:row.created,updated:row.updated,status:row.status,iv:iv.buffer,cipher};
}
async function decode(db:IDBDatabase,row:EncryptedRecord):Promise<QueuedSale>{
 const key=await readKey(db,row.scope);if(!key)throw Error('The local encryption key is missing. Preserve this browser profile and contact your administrator; do not clear queued records.');
 let value:{command:unknown;error?:string;reference?:string};try{const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:authenticatedMetadata(row)},key,row.cipher);value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('A queued sale could not be authenticated. Preserve this browser profile for recovery.');}
 const command=posCommand.parse(value.command);if(command.action!=='sale')throw Error('Invalid queued sale');
 const [slug,actor]=JSON.parse(row.scope) as string[];if(!slug||!actor||row.id!==`${row.scope}:${command.key}`)throw Error('Queued sale identity mismatch');
 return {id:row.id,scope:row.scope,created:row.created,updated:row.updated,status:row.status,command,error:value.error,reference:value.reference};
}
export async function listQueuedSales(scope:string):Promise<QueuedSale[]>{const db=await database();try{const tx=db.transaction('sales','readonly'),rows=await request(tx.objectStore('sales').index('scope').getAll(scope)) as EncryptedRecord[];return(await Promise.all(rows.map(r=>decode(db,r)))).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));}finally{db.close();}}
export async function enqueueSale(scope:string,command:Extract<PosCommand,{action:'sale'}>):Promise<QueuedSale>{
 const db=await database();try{
  const id=`${scope}:${command.key}`,read=db.transaction('sales','readonly'),old=await request(read.objectStore('sales').get(id)) as EncryptedRecord|undefined;
  if(old){const previous=await decode(db,old);if(JSON.stringify(previous.command)!==JSON.stringify(command))throw Error('A local transaction reference was reused with different details');return previous;}
  const existing=await listQueuedSales(scope);if(existing.filter(r=>r.status==='pending'||r.status==='review').length>=500)throw Error('Synchronize or resolve existing queued sales before recording more transactions.');
  const now=Date.now(),row:QueuedSale={id,scope,created:now,updated:now,status:'pending',command},encrypted=await encode(db,row),tx=db.transaction('sales','readwrite'),finished=complete(tx);tx.objectStore('sales').add(encrypted);await finished;return row;
 }finally{db.close();}
}
export async function updateQueuedSale(row:QueuedSale,changes:Pick<QueuedSale,'status'> & Partial<Pick<QueuedSale,'error'|'reference'>>){
 const db=await database();try{
  const updated={...row,...changes,updated:Date.now()},encrypted=await encode(db,updated),tx=db.transaction('sales','readwrite'),finished=complete(tx);tx.objectStore('sales').put(encrypted);await finished;
  if(changes.status==='confirmed'){
   const read=db.transaction('sales','readonly'),rows=await request(read.objectStore('sales').index('scope').getAll(row.scope)) as EncryptedRecord[];
   const older=rows.filter(r=>r.status==='confirmed').sort((a,b)=>b.updated-a.updated).slice(100);
   if(older.length){const prune=db.transaction('sales','readwrite'),done=complete(prune);for(const r of older)prune.objectStore('sales').delete(r.id);await done;}
  }
  return updated;
 }finally{db.close();}
}
let localLock:Promise<unknown>=Promise.resolve();
export async function withPosQueueLock<T>(scope:string,work:()=>Promise<T>):Promise<T>{
 if(navigator.locks)return navigator.locks.request('bizhub-pos-sync:'+scope,work);
 // IndexedDB key uniqueness remains the final duplicate boundary in older browsers.
 const next=localLock.then(work,work);localLock=next.catch(()=>undefined);return next;
}
