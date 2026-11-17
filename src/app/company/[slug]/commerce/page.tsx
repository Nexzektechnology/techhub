import Link from 'next/link';
import {tenantCommerce} from '@/lib/tenant-server';
import {TenantCommerceWorkspace} from '@/components/tenant-commerce-workspace';
export const metadata={title:'Company commerce and inventory',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{page?:string}>}){
 const {slug}=await params;const raw=Number((await searchParams).page||1),page=Number.isInteger(raw)&&raw>0&&raw<=100000?raw:1;
 const data=await tenantCommerce(slug,page).catch(()=>null);
 if(!data)return <main className="platform-root platform-locked"><h1>Company commerce access required.</h1><p>Sign in with an active company membership and a plan that includes commerce.</p><Link className="button" href={`/login?next=${encodeURIComponent(`/company/${slug}/commerce`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 return <TenantCommerceWorkspace slug={slug} name={data.company.name} brand={data.company.brand} data={data.snapshot} page={page}/>;
}
