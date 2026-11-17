import {NextResponse} from 'next/server';
import {z} from 'zod';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {service} from '@/lib/server';
import {MAX_FILE_BYTES,prepareFile} from '@/lib/saas-files';
import {boundedJson} from '@/lib/saas-server';
const idInput=z.object({id:z.uuid()}).strict();
export async function GET(req:Request){try{
 const {db}=await platformIdentity();const {id}=idInput.parse({id:new URL(req.url).searchParams.get('id')});
 const asset=await db.from('saas_assets').select('path').eq('id',id).eq('state','ready').single();if(asset.error||!asset.data)throw Error('File unavailable');
 // The user-scoped Storage client enforces the object policy before signing.
 const signed=await db.storage.from('tenant-files').createSignedUrl(asset.data.path,60,{download:true});if(signed.error)throw Error('File unavailable');
 return NextResponse.json({url:signed.data.signedUrl},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 guard(req);const {db}=await platformIdentity();
 const throttle=await db.rpc('saas_rate_limit',{p_action:'assets'});if(throttle.error)throw Error(throttle.error.message);
 // Require an honest, bounded multipart envelope before decoding it in memory.
 const length=Number(req.headers.get('content-length'));if(!length||length>MAX_FILE_BYTES+65536)throw Error('Choose a file under 5 MB');
 const reader=req.body?.getReader();if(!reader)throw Error('File required');const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_FILE_BYTES+65536){await reader.cancel();throw Error('Upload too large');}chunks.push(value);}}finally{reader.releaseLock();}
 const form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:Buffer.concat(chunks)}).formData();
 const company=z.uuid().parse(form.get('company_id'));const folder=z.enum(['logos','products','invoices','documents','avatars']).parse(form.get('folder'));
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>MAX_FILE_BYTES)throw Error('Choose a file under 5 MB');
 const {buffer,mime}=await prepareFile(Buffer.from(await file.arrayBuffer()),file.type,folder);
 const reservation=await db.rpc('saas_reserve_asset',{p_company:company,p_folder:folder,p_mime:mime,p_size:buffer.length});if(reservation.error)throw Error(reservation.error.message);
 const {id,path}=reservation.data;const trusted=service();
 const upload=await trusted.storage.from('tenant-files').upload(path,buffer,{contentType:mime,upsert:false});
 if(upload.error){
  // A timeout may have stored the object. Release quota only after confirmed cleanup.
  const removed=await trusted.storage.from('tenant-files').remove([path]);
  if(!removed.error)await trusted.rpc('saas_finalize_asset',{p_id:id,p_ready:false});
  throw Error('Upload failed. Retry later; uncertain uploads retain their reserved quota until reconciled.');
 }
 const finalized=await trusted.rpc('saas_finalize_asset',{p_id:id,p_ready:true});if(finalized.error)throw Error('File stored; registration requires reconciliation');
 return NextResponse.json({ok:true,id},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function DELETE(req:Request){try{
 guard(req);const {db}=await platformIdentity();const {id}=idInput.parse(await boundedJson(req));
 const asset=await db.from('saas_assets').select('path,company_id').eq('id',id).neq('state','deleted').single();if(asset.error||!asset.data)throw Error('File unavailable');
 const writable=await db.rpc('saas_can_write',{p_company:asset.data.company_id});if(writable.error||!writable.data)throw Error('Subscription is read-only');
 const trusted=service();const removed=await trusted.storage.from('tenant-files').remove([asset.data.path]);if(removed.error)throw Error('File deletion could not be confirmed');
 const r=await trusted.rpc('saas_remove_asset',{p_id:id});if(r.error)throw Error('Deletion completed; storage accounting needs reconciliation');
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
