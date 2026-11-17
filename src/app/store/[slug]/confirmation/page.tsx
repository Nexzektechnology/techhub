import Link from 'next/link';
import {supabase} from '@/lib/server';
import {TenantConfirmation} from '@/components/tenant-confirmation';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{reference?:string}>}){const {slug}=await params,{reference}=await searchParams;if(!reference||!/^edge-tenant-[0-9a-f-]{36}$/.test(reference))return <div className="container narrow-page"><h1>Order reference required.</h1></div>;const r=await(await supabase()).rpc('tenant_my_order',{p_slug:slug,p_reference:reference});if(r.error||!r.data)return <div className="container narrow-page"><h1>Sign in to view your order.</h1><Link className="button" href={`/login?next=${encodeURIComponent(`/store/${slug}/confirmation?reference=${reference}`)}`}>Sign in</Link></div>;return <TenantConfirmation slug={slug} order={r.data}/>;}
