import { AuthForm } from '@/components/auth-form';
import { workspacePath } from '@/lib/workspace-path';
export default async function Page({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){return <AuthForm platform={process.env.SAAS_PLATFORM_SITE==='true'} register returnTo={workspacePath((await searchParams).next)}/>;}
