import {redirect} from 'next/navigation';
import {tenantPublicContext} from '@/lib/tenant-public-context';
import {TenantCheckoutHandoff} from '@/components/tenant-checkout-handoff';
export const metadata={title:'Secure checkout',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(await tenantPublicContext(slug))redirect(`/store/${slug}/cart`);return <TenantCheckoutHandoff slug={slug}/>;}
