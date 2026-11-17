import Link from 'next/link';
import {configured,supabase} from '@/lib/server';
import {saasCatalog} from '@/lib/saas-server';
import {SaasOnboarding} from '@/components/saas-onboarding';
export const metadata={title:'Create your company workspace',robots:{index:false,follow:false}};
export default async function Page(){
 const user=configured()?(await(await supabase()).auth.getUser()).data.user:null;
 if(!user||user.is_anonymous||!user.email_confirmed_at)return <main className="platform-root platform-locked"><span className="eyebrow">COMPANY REGISTRATION</span><h1>Start with a verified account.</h1><p>Confirm your email to create and administer your company.</p><div className="hero-buttons"><Link className="button" href="/register?next=/start">Create your account</Link><Link className="small-button" href="/login?next=/start">Sign in</Link></div></main>;
 const catalog=await saasCatalog().catch(()=>null);
 if(!catalog)return <main className="platform-root platform-locked"><h1>Plans are temporarily unavailable.</h1><p>Please try again later.</p><Link href="/workspaces">Your workspaces</Link></main>;
 return <SaasOnboarding {...catalog} email={user.email||''}/>;
}
