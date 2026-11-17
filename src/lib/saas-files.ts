import 'server-only';
import sharp from 'sharp';
export const MAX_FILE_BYTES=5*1024*1024;
export function fileMime(bytes:Uint8Array):string|null{
 const b=Buffer.from(bytes);if(b.length<12)return null;
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';
 if(b.toString('ascii',0,5)==='%PDF-')return 'application/pdf';return null;
}
export async function prepareFile(bytes:Buffer,declared:string,folder:string){
 const mime=fileMime(bytes);if(!mime||mime!==declared)throw Error('Use a valid PNG, JPEG, WebP or PDF. SVG is not allowed.');
 if(mime==='application/pdf'){
  if(['logos','products','avatars'].includes(folder))throw Error('Choose an image for this folder');
  if(!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw Error('Invalid PDF file');
  return {buffer:bytes,mime};
 }
 try{
  const image=sharp(bytes,{limitInputPixels:20000000,failOn:'warning',animated:false});
  const metadata=await image.metadata();if(!metadata.width||!metadata.height||(metadata.pages||1)>1)throw Error('Invalid image');
  const buffer=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
  if(!buffer.length||buffer.length>MAX_FILE_BYTES)throw Error('Image too large');
  return {buffer,mime:'image/webp'};
 }catch{throw Error('Choose a valid single-frame image under 20 megapixels');}
}
