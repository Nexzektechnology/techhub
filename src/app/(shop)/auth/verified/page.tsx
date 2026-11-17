import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import {verificationNext} from '@/lib/workspace-path';
import { configured, supabase } from '@/lib/server';

export const metadata = { title: 'Email confirmed', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = configured() ? (await (await supabase()).auth.getUser()).data.user : null;
  if (!user || user.is_anonymous || !user.email_confirmed_at) redirect('/login');
  const next=verificationNext((await searchParams).next);const checkout=!!next&&next!=='/start';
  const start = (await searchParams).next === '/start';
  return <div className="container narrow-page auth-page"><span className="auth-icon"><CheckCircle2 /></span><span className="eyebrow muted">YOU’RE ALL SET</span><h1>Email confirmed.</h1><div className="form-panel"><p role="status">Your email is verified and you’re signed in. You can now continue {checkout ? 'to checkout' : start?'to company registration':'to your account'}.</p><p className="recovery-identity">{user.email}</p><Link href={checkout ? next! : start?'/start':'/account'} className="button">{checkout ? 'Continue to checkout' : start?'Register your company':'Open my account'}<ArrowRight size={17}/></Link></div></div>;
}
