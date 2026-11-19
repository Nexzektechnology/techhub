import Link from 'next/link';
import { redirect } from 'next/navigation';
import { configured, supabase } from '@/lib/server';
import { PlatformMfa } from '@/components/platform-mfa';

export const metadata = { title: 'Platform security', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const signIn = '/login?next=%2Fplatform%2Fsecurity';

export default async function Page() {
  if (!configured()) return <main className="platform-root platform-main"><h1>Account verification is unavailable</h1><p>The sign-in service is not configured.</p></main>;
  const db = await supabase();
  const {data: {user}, error} = await db.auth.getUser();
  if (error || !user || user.is_anonymous) redirect(signIn);
  const owner = await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('active',true).maybeSingle();
  if (owner.error) return <main className="platform-root platform-main"><h1>Could not check administrator access</h1><p>Refresh this page to try again.</p></main>;
  if (!owner.data) return <main className="platform-root platform-main"><h1>Platform owner access required</h1><Link href={signIn}>Sign in with the platform owner account</Link></main>;
  const verified = user.factors?.find(f => f.factor_type === 'totp' && f.status === 'verified');
  return <main className="platform-root platform-main"><Link href="/platform">← Platform</Link><div className="platform-heading"><div><span className="eyebrow">IDENTITY &amp; ACCESS</span><h1>Verify your identity</h1><p>Signed in as {user.email}</p></div></div><PlatformMfa initialFactor={verified?.id}/></main>;
}
