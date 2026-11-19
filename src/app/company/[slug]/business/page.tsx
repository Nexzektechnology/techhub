import Link from 'next/link';
import {platformIdentity} from '@/lib/platform-server';
import {businessFilters,type BusinessSnapshot} from '@/lib/business-os';
import {BusinessWorkspace} from '@/components/business-workspace';

export const metadata={title:'Business operations',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,parsed=businessFilters.safeParse(await searchParams);
 if(!parsed.success)return <main className="platform-root platform-locked"><h1>Check your filters</h1><p>Use a valid branch, a search of up to 100 characters, and a positive page number.</p><Link href={`/company/${slug}/business`}>Reset filters</Link></main>;
 const filters=parsed.data;
 const workspace=await(async()=>{try{
  const {db}=await platformIdentity(),company=await db.rpc('company_context',{p_slug:slug});
  if(company.error||!company.data)return null;
  const snapshot=await db.rpc('tenant_business_snapshot',{p_company:company.data.id,p_branch:filters.branch||null,p_query:filters.q,p_page:filters.page});
  if(snapshot.error||!snapshot.data)return null;
  return {company:company.data,snapshot:snapshot.data as BusinessSnapshot};
 }catch{return null;}})();
 if(!workspace)return <main className="platform-root platform-locked"><h1>Business workspace unavailable</h1><p>Use an active company membership with commerce enabled. Your administrator can check your permissions and workspace setup.</p><Link href={`/login?next=${encodeURIComponent(`/company/${slug}/business`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 return <BusinessWorkspace slug={slug} name={workspace.company.name} brand={workspace.company.brand} data={workspace.snapshot} filters={filters}/>;
}
