import type {ReactNode} from 'react';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {tenantStorefront} from '@/lib/tenant-server';
import {tenantPublicContext} from '@/lib/tenant-public-context';
import {TenantStoreFrame} from '@/components/tenant-store-frame';
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const {slug}=await params;const data=await tenantStorefront(slug).catch(()=>null);if(!data)return {title:{absolute:'Store unavailable'},robots:{index:false,follow:false}};return {title:{absolute:data.company.brand.seoTitle||data.company.name},description:data.company.brand.seoDescription,icons:data.company.brand.favicon?{icon:data.company.brand.favicon}:{icon:[],apple:[]},openGraph:{title:data.company.name,description:data.company.brand.seoDescription,images:data.company.brand.logo?[{url:data.company.brand.logo}]:[]}};}
export default async function Layout({params,children}:{params:Promise<{slug:string}>;children:ReactNode}){const {slug}=await params;const data=await tenantStorefront(slug).catch(()=>null);if(!data)notFound();const custom=await tenantPublicContext(slug);return <TenantStoreFrame store={data} canonical={custom?.canonical}>{children}</TenantStoreFrame>;}
