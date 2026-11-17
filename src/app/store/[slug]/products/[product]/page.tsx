import {notFound} from 'next/navigation';
import {tenantStorefront} from '@/lib/tenant-server';
import {tenantPublicContext} from '@/lib/tenant-public-context';
import {ProductDetail} from '@/components/product-detail';
export default async function Page({params}:{params:Promise<{slug:string;product:string}>}){const {slug,product}=await params;const custom=await tenantPublicContext(slug),s=await tenantStorefront(slug,'',1,product),p=s.products[0];if(!p)notFound();return <div className="container catalog-page"><ProductDetail product={p} reviews={[]} tenantStore storeBase={custom?'':`/store/${slug}`}/></div>;}
