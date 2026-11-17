import Link from 'next/link';
import {saasOverview} from '@/lib/saas-server';
import {SaasConsole} from '@/components/saas-console';
export const metadata={title:'SaaS plans and billing',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string}>}){
 const raw=Number((await searchParams).page||1);const page=Number.isInteger(raw)&&raw>=1&&raw<=100000?raw:1;
 const data=await saasOverview(page).catch(()=>null);
 if(!data)return <main className="platform-root platform-locked"><h1>Platform owner access required.</h1><p>A separately authorized administrator and verified second factor are required.</p><Link className="button" href="/platform/security">Verify your authenticator</Link></main>;
 return <SaasConsole data={data} page={page}/>;
}
