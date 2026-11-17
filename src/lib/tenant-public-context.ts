import 'server-only';
import {headers} from 'next/headers';
export async function tenantPublicContext(slug?:string){
 const h=await headers(),tenant=h.get('x-saas-public-tenant');
 if(!tenant||slug&&tenant!==slug)return null;
 const origin=new URL(process.env.NEXT_PUBLIC_SITE_URL||'');
 return {slug:tenant,host:h.get('x-saas-public-host')||'',canonical:origin.origin};
}
