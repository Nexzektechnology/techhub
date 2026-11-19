import Link from 'next/link';
import {platformIdentity} from '@/lib/platform-server';
import {affiliateFilters,type AffiliateSnapshot} from '@/lib/tenant-affiliates';
import {AffiliateWorkspace} from '@/components/affiliate-workspace';
export const metadata={title:'Affiliate accountability',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,parsed=affiliateFilters.safeParse(await searchParams);
 const workspace=await(async()=>{try{if(!parsed.success)return null;const {db,user}=await platformIdentity(),c=await db.rpc('tenant_affiliate_context',{p_slug:slug});if(c.error||!c.data)return null;const f=parsed.data,r=await db.rpc('tenant_affiliate_snapshot',{p_company:c.data.id,p_affiliate:f.affiliate||null,p_release:f.release||null,p_page:f.page});if(r.error)return null;return {company:c.data,data:r.data as AffiliateSnapshot,actor:user.id};}catch{return null;}})();
 if(!workspace||!parsed.success)return <main className="platform-root platform-locked"><h1>Affiliate access required</h1><p>Sign in with your verified affiliate email or an authorized company account.</p><Link href={`/login?next=${encodeURIComponent(`/company/${slug}/affiliates`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 return <AffiliateWorkspace slug={slug} name={workspace.company.name} brand={workspace.company.brand} actor={workspace.actor} data={workspace.data} filters={parsed.data}/>;
}
