import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabase,service} from '@/lib/server';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const parsed=z.uuid().safeParse((await params).id);if(!parsed.success)return new NextResponse('Unavailable',{status:404});
 try{
  const db=await supabase();const logo=await db.rpc('saas_public_logo',{p_id:parsed.data});
  if(logo.error||!logo.data)return new NextResponse('Unavailable',{status:404});
  const signed=await service().storage.from('tenant-files').createSignedUrl(logo.data,60);
  if(signed.error)throw Error('Unavailable');
  return NextResponse.redirect(signed.data.signedUrl,{status:307,headers:{'Cache-Control':'public, max-age=30','X-Content-Type-Options':'nosniff'}});
 }catch{return new NextResponse('Unavailable',{status:404});}
}
