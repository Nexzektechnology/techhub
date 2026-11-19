import Link from 'next/link';
import {platformIdentity} from '@/lib/platform-server';
import {posFilters,type PosSnapshot} from '@/lib/tenant-pos';
import {TenantPos} from '@/components/tenant-pos';
export const metadata={title:'Sales and point of sale',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,parsed=posFilters.safeParse(await searchParams);
 const workspace=await(async()=>{try{if(!parsed.success)return null;const {db,user}=await platformIdentity(),c=await db.rpc('company_context',{p_slug:slug});if(c.error||!c.data)return null;const r=await db.rpc('tenant_pos_snapshot',{p_company:c.data.id,p_warehouse:parsed.data.warehouse||null,p_query:parsed.data.q,p_page:parsed.data.page});if(r.error)return null;const selected=parsed.data.sale?await db.rpc('tenant_pos_get_sale',{p_company:c.data.id,p_sale:parsed.data.sale}):null;return {company:c.data,data:{...r.data,...(selected&&!selected.error?{selected_sale:selected.data}:{})} as PosSnapshot,user:user.id};}catch{return null;}})();
 if(!workspace||!parsed.success)return <main className="platform-root platform-locked"><h1>Sales workspace unavailable</h1><p>Sign in with an active company membership and sales permissions for your location.</p><Link href={`/login?next=${encodeURIComponent(`/company/${slug}/pos`)}`}>Sign in</Link><Link href="/workspaces">Your workspaces</Link></main>;
 return <TenantPos slug={slug} name={workspace.company.name} brand={workspace.company.brand} data={workspace.data} actor={workspace.user} filters={parsed.data}/>;
}
