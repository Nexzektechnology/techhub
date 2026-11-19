import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ShopProvider } from '@/components/shop-state';
import { configured, publishedTheme } from '@/lib/server';
import { AuthLanding } from '@/components/auth-landing';
import { AppLifecycle } from '@/components/app-install';
import {AccountSessionBar} from '@/components/account-session-bar';
import {LogoutSessionSync} from '@/components/logout-session-sync';
import {tenantPublicContext} from '@/lib/tenant-public-context';
import {tenantStorefront} from '@/lib/tenant-server';
import {OfflineRegistration} from '@/components/offline-access';
import './globals.css';
export async function generateMetadata():Promise<Metadata> {const custom=await tenantPublicContext();if(custom){const s=await tenantStorefront(custom.slug);return {title:s.company.name,description:s.company.brand.seoDescription,metadataBase:new URL(`https://${custom.host}`),icons:s.company.brand.favicon?{icon:s.company.brand.favicon}:{icon:[],apple:[]},openGraph:{title:s.company.name,description:s.company.brand.seoDescription,images:s.company.brand.logo?[{url:s.company.brand.logo}]:[]}};}if(process.env.SAAS_PLATFORM_SITE==='true')return {manifest:'/bizhub.webmanifest',title:{default:'Nexzek BizHub',template:'%s | Nexzek BizHub'},description:'Manage your products, stock, team and branded business storefront.',metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL||'https://nexzekbizhub.com'),icons:{icon:'/bizhub.svg'}};const theme=await publishedTheme();return {title:{default:theme.seoTitle,template:`%s | ${theme.name}`},description:theme.seoDescription,metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL||'https://edgedirect2u.com'),manifest:'/store.webmanifest',appleWebApp:{capable:true,title:theme.name,statusBarStyle:'default'},icons:{apple:'/icons/apple-touch-20261021.png',...(theme.favicon?{icon:theme.favicon}:{})},openGraph:{title:theme.seoTitle,description:theme.seoDescription}};}
export default async function RootLayout({children}:{children:React.ReactNode}) {await connection();const publicStore=await tenantPublicContext();return <html lang="en" data-scroll-behavior="smooth" data-platform={process.env.SAAS_PLATFORM_SITE==='true'?'bizhub':undefined}><body><ShopProvider>{!publicStore&&<><AuthLanding liveOrigin={configured()&&process.env.SAAS_PLATFORM_SITE!=='true'?'https://edgedirect2u.com':undefined}/>{process.env.SAAS_PLATFORM_SITE==='true'?<OfflineRegistration/>:<AppLifecycle/>}<LogoutSessionSync/><AccountSessionBar/></>}{children}</ShopProvider></body></html>;}
