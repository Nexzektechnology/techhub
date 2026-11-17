'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {handoffCart} from '@/lib/cart-handoff';
import {cartKey,restoreShopping} from '@/lib/shopping-storage';
import type {Product} from '@/lib/types';
import {useShop} from './shop-state';
export function TenantCheckoutHandoff({slug}:{slug:string}){
 const {replaceCart}=useShop(),router=useRouter(),payload=useRef<string|null>(null),finished=useRef(false),[error,setError]=useState('');
 useEffect(()=>{
  if(finished.current)return;const abort=new AbortController();let active=true;
  if(payload.current===null){payload.current=window.location.hash;window.history.replaceState(null,'',window.location.pathname);}
  async function transfer(){try{
   const hash=payload.current||'';if(hash.length>150000)throw Error('The bag transfer is too large');const raw=new URLSearchParams(hash.slice(1)).get('bag');if(!raw||raw.length>16000)throw Error('Open checkout from your store bag to continue');
   const lines=handoffCart.parse(JSON.parse(raw)),ids=[...new Set(lines.map(l=>l.id))];const r=await fetch(`/api/tenant/${slug}/catalogue?${new URLSearchParams(ids.map(id=>['id',id]))}`,{cache:'no-store',signal:abort.signal});if(!r.ok)throw Error('Your store is temporarily unavailable');
   const products=await r.json() as Product[],byId=new Map(products.map(p=>[p.id,p]));const cart=lines.map(l=>{const product=byId.get(l.id);if(!product)throw Error('An item is no longer available. Review your store bag.');return {key:cartKey(l.id,l.options),product,quantity:l.quantity,options:l.options};});
   const restored=restoreShopping(JSON.stringify({cart,wishlist:[]}));if(restored.cart.length!==cart.length)throw Error('Your bag could not be transferred. Please review it in the store.');
   if(active){finished.current=true;replaceCart(restored.cart);router.replace(`/store/${slug}/checkout`);}
  }catch(e){if(active)setError(e instanceof Error?e.message:'Your bag could not be transferred');}}
  void transfer();return()=>{active=false;abort.abort();};
 },[slug,replaceCart,router]);
 return <div className="container narrow-page"><h1>{error?'Review your bag.':'Opening secure checkout…'}</h1><p role={error?'alert':'status'}>{error||'We are checking the latest store prices and bringing your bag into the secure checkout.'}</p>{error&&<Link className="button" href={`/store/${slug}`}>Return to the store</Link>}</div>;
}
