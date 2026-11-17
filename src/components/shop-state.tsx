'use client';
import { createContext, useContext, useSyncExternalStore, useState, useRef, useEffect,useMemo,useCallback, type ReactNode } from 'react';
import type { Product } from '@/lib/types';
import { cartKey, restoreShopping, type ShoppingState as State } from '@/lib/shopping-storage';
export type { CartLine } from '@/lib/shopping-storage';
const empty:State={cart:[],wishlist:[]};
function shoppingStore(key:string){
 let snapshot=empty,loaded=false;const listeners=new Set<()=>void>();
 const getState=()=>{if(!loaded&&typeof window!=='undefined'){loaded=true;try{snapshot=restoreShopping(localStorage.getItem(key));}catch{}}return snapshot;};
 const update=(value:State)=>{snapshot=value;try{localStorage.setItem(key,JSON.stringify(value));}catch{}listeners.forEach(fn=>fn());};
 const changed=(event:StorageEvent)=>{if(event.key===key||event.key===null){snapshot=restoreShopping(event.newValue);listeners.forEach(fn=>fn());}};
 const subscribe=(fn:()=>void)=>{if(!listeners.size)window.addEventListener('storage',changed);listeners.add(fn);return()=>{listeners.delete(fn);if(!listeners.size)window.removeEventListener('storage',changed);};};
 return {getState,update,subscribe};
}
const flagship=shoppingStore('edge-shopping');const {getState,update}=flagship;
export function mergeAccountWishlist(ids:string[]){const current=getState(),wishlist=[...new Set([...current.wishlist,...ids])];if(wishlist.length>100)throw Error('Your combined wishlist exceeds 100 finds. Remove some device finds before adding your account list.');if(wishlist.length!==current.wishlist.length)update({...current,wishlist});}
async function refresh(store:ReturnType<typeof shoppingStore>,endpoint:string){const current=store.getState(),ids=[...new Set(current.cart.map(c=>c.product.id))];if(!ids.length)return;const r=await fetch(endpoint+'?'+new URLSearchParams(ids.map(id=>['id',id])),{cache:'no-store'});if(!r.ok)throw Error('Prices could not be refreshed. Please try again.');const products=await r.json() as Product[],byId=new Map(products.map(p=>[p.id,p]));const latest=store.getState();if(latest.cart.some(c=>!ids.includes(c.product.id)))throw Error('Your bag changed during the refresh. Please refresh prices again.');const missing=latest.cart.find(c=>!byId.has(c.product.id));if(missing)throw Error(`${missing.product.name} is no longer available. Remove it from your bag before refreshing the other items.`);store.update({...latest,cart:latest.cart.map(c=>({...c,product:byId.get(c.product.id)!}))});}
export async function refreshCartPrices(){return refresh(flagship,'/api/wishlist');}
const Context=createContext<{state:State;add:(p:Product,q?:number,o?:Record<string,string>)=>void;quantity:(key:string,q:number)=>void;wish:(id:string)=>void;clear:()=>void;replaceCart:(cart:State['cart'])=>void;notify:(s:string)=>void;refreshPrices:()=>Promise<void>} | null>(null);
export function ShopProvider({children,namespace,refreshEndpoint='/api/wishlist'}:{children:ReactNode;namespace?:string;refreshEndpoint?:string}) {
  const store=useMemo(()=>namespace?shoppingStore(`edge-shopping:${namespace}`):flagship,[namespace]);
  const {getState,update,subscribe}=store;const state=useSyncExternalStore(subscribe,getState,()=>empty); const [toast,setToast]=useState('');
  const replaceCart=useCallback((cart:State['cart'])=>update(restoreShopping(JSON.stringify({cart,wishlist:getState().wishlist}))),[getState,update]);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const notify=(text:string)=>{if(timer.current)clearTimeout(timer.current);setToast(text);timer.current=setTimeout(()=>setToast(''),3500);};
  function add(product:Product,quantity=1,options:Record<string,string>={}) { if(!Number.isInteger(quantity)||quantity<1||product.stock-product.reserved<quantity){notify('This item is currently unavailable');return;} const key=cartKey(product.id,options); const current=getState(); const exists=current.cart.find(c=>c.key===key); if(!exists&&current.cart.length>=50){notify('Your bag holds up to 50 different finds.');return;} update({...current,cart:exists?current.cart.map(c=>c.key===key?{...c,product,quantity:Math.min(50,c.quantity+quantity,product.stock-product.reserved)}:c):[...current.cart,{key,product,quantity:Math.min(quantity,50),options}]});notify('Added to your bag'); }
  return <Context.Provider value={{state,add,quantity:(key,q)=>update({...getState(),cart:getState().cart.map(c=>c.key===key?{...c,quantity:Math.max(0,Math.min(50,Number.isFinite(q)?Math.floor(q):0,c.product.stock-c.product.reserved))}:c).filter(c=>c.quantity>0)}),wish:id=>{const s=getState();if(!s.wishlist.includes(id)&&s.wishlist.length>=100){notify('Your wishlist holds up to 100 finds. Remove one to save another.');return;}update({...s,wishlist:s.wishlist.includes(id)?s.wishlist.filter(i=>i!==id):[...s.wishlist,id]});},clear:()=>update({...getState(),cart:[]}),replaceCart,notify,refreshPrices:()=>refresh(store,refreshEndpoint)}}>{children}{toast&&<div className="toast" role="status">{toast}</div>}</Context.Provider>;
}
export function useShop(){const value=useContext(Context);if(!value)throw new Error('ShopProvider missing');return value;}
