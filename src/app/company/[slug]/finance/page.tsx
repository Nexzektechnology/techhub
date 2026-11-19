import Link from 'next/link';
import {platformIdentity} from '@/lib/platform-server';
import {financeFilters,type FinanceSnapshot} from '@/lib/tenant-finance';
import {FinanceWorkspace} from '@/components/finance-workspace';
export const metadata={title:'Finance and bookkeeping',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,parsed=financeFilters.safeParse(await searchParams);
 const workspace=await(async()=>{try{if(!parsed.success)return null;const {db}=await platformIdentity(),c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)return null;const f=parsed.data,r=await db.rpc('tenant_finance_snapshot',{p_company:c.data.id,p_warehouse:f.warehouse||null,p_from:f.from||null,p_to:f.to||null,p_account:f.account,p_page:f.page,p_balance:f.balance==='1'});if(r.error)return null;return {company:c.data,data:r.data as FinanceSnapshot};}catch{return null;}})();
 if(!workspace||!parsed.success)return <main className="platform-root platform-locked"><h1>Finance access required</h1><p>Use a company membership with financial read permissions for your location. A company administrator can configure your access.</p><Link href={`/login?next=${encodeURIComponent(`/company/${slug}/finance`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 return <FinanceWorkspace slug={slug} name={workspace.company.name} brand={workspace.company.brand} data={workspace.data} filters={parsed.data}/>;
}
