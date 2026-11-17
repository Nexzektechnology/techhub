import {Cart} from '@/components/cart';
import {tenantPublicContext} from '@/lib/tenant-public-context';
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const custom=await tenantPublicContext(slug);return <Cart storeBase={`/store/${slug}`} handoffOrigin={custom?.canonical}/>;}
