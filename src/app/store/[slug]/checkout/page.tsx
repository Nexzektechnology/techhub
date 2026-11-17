import {redirect} from 'next/navigation';
import {Cart} from '@/components/cart';
import {tenantStorefront} from '@/lib/tenant-server';
import {supabase} from '@/lib/server';
import {tenantPublicContext} from '@/lib/tenant-public-context';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const custom=await tenantPublicContext(slug);if(custom)return <Cart storeBase={`/store/${slug}`} handoffOrigin={custom.canonical}/>;const db=await supabase(),identity=await db.auth.getUser();if(identity.error||!identity.data.user||identity.data.user.is_anonymous||!identity.data.user.email_confirmed_at)redirect(`/login?next=${encodeURIComponent(`/store/${slug}/checkout`)}`);const s=await tenantStorefront(slug);return <Cart checkout storeBase={`/store/${slug}`} checkoutEndpoint={`/api/tenant/${slug}/checkout`} deliveryFee={s.delivery_kobo} email={identity.data.user.email||''} paymentsReady={s.checkout_ready&&!!process.env.PAYSTACK_SECRET_KEY&&!!process.env.SUPABASE_SERVICE_ROLE_KEY}/>;}
