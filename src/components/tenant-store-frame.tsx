'use client';
import type {ReactNode,CSSProperties} from 'react';
import Link from 'next/link';
import {ShopProvider,useShop} from './shop-state';
import {Logo} from './store-shell';
import {themeTokens} from '@/lib/theme';
import type {TenantStorefront} from '@/lib/tenant-commerce';
export function TenantStoreFrame({store,children,canonical}:{store:TenantStorefront;children:ReactNode;canonical?:string}){
 return <ShopProvider namespace={store.company.id} refreshEndpoint={`/api/tenant/${store.company.slug}/catalogue`}><Frame store={store} canonical={canonical}>{children}</Frame></ShopProvider>;
}
function Frame({store:s,children,canonical}:{store:TenantStorefront;children:ReactNode;canonical?:string}){const {state}=useShop(),base=canonical?'':`/store/${s.company.slug}`;return <div className="themed-store tenant-store" style={themeTokens(s.company.brand) as CSSProperties}><a className="skip-link" href="#tenant-content">Skip to content</a><header className="platform-header"><Logo theme={s.company.brand} homeHref={base||'/'}/><form action={base||'/'}><label className="sr-only" htmlFor="tenant-search">Search products</label><input id="tenant-search" name="q" maxLength={120} placeholder="Search this store"/><button className="small-button">Search</button></form><Link href={`${base}/cart`}>Bag · {state.cart.reduce((n,line)=>n+line.quantity,0)}</Link></header><main id="tenant-content" tabIndex={-1}>{children}</main><footer className="platform-footer">{s.company.brand.copyright||s.company.name} · <Link href={`${canonical||''}/login?next=${encodeURIComponent(`/company/${s.company.slug}`)}`}>Manage business</Link></footer></div>;}
