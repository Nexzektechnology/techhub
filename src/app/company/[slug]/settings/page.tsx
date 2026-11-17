import Link from 'next/link';
import {saasPortal,saasCatalog} from '@/lib/saas-server';
import {SaasSettings} from '@/components/saas-settings';
import {supabase} from '@/lib/server';
import {automaticBillingConfigured} from '@/lib/billing-authorization';
export const metadata={title:'Company account and billing',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const data=await Promise.all([saasPortal(slug),saasCatalog()]).catch(()=>null);
 if(!data)return <main className="platform-root platform-locked"><h1>Company administrator access required.</h1><p>Sign in with an active membership to review your company account.</p><Link className="button" href={`/login?next=${encodeURIComponent(`/company/${slug}/settings`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 const db=await supabase();const address=process.env.SAAS_TENANT_ROOT_DOMAIN?await db.from('saas_subdomains').select('label').eq('company_id',data[0].company.id).maybeSingle():null;const businessAddress=address?.data?.label?`https://${address.data.label}.${process.env.SAAS_TENANT_ROOT_DOMAIN}`:undefined;const automatic=await db.rpc('saas_autopay_status',{p_company:data[0].company.id});
 return <SaasSettings businessAddress={businessAddress} portal={data[0]} {...data[1]} billingReady={!!process.env.SAAS_PAYSTACK_SECRET_KEY&&!!process.env.SUPABASE_SERVICE_ROLE_KEY} automaticReady={automaticBillingConfigured()} automatic={automatic.error?undefined:automatic.data}/>;
}
