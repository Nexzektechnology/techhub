import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,cid:string,wid:string,product:string,black:string,blue:string;
type Order={id:string;reference:string;total_kobo:number;status:string;items:{id:string;serials?:{id:string;serial:string;imei:string|null}[]}[]};
const input=(colour:string,key=randomUUID())=>({key,items:[{product_id:product,quantity:1,expected_price_kobo:10000,options:{Colour:colour}}],address:{name:'Serial buyer',email:'customer@tenant.example',phone:'08012345678',street:'123 Customer Street',city:'Lagos',state:'Lagos'},coupon:''});
const checkout=(data:unknown)=>identity(db,actors.customer,()=>value<Order>(db,"select tenant_checkout('serial-store',$1) v",[data]));
const state=(id:string)=>value(db,'select state v from tenant_serial_units where company_id=$1 and id=$2',[cid,id]);
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','serial-store');const cmd=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
 const branch=(await cmd('branch',{name:'Lagos'})).id;wid=(await cmd('warehouse',{name:'Main',branch_id:branch})).id;const category=(await cmd('category',{name:'Devices'})).id;product=(await cmd('product',{name:'Phone',slug:'phone',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{Colour:['Black','Blue','Green']}})).id;
 await db.query('update products set cost_kobo=6000 where id=$1',[product]);await cmd('stock',{warehouse_id:wid,product_id:product,delta:2,reason:'Verified stock before serial commissioning'});await cmd('storefront',{warehouse_id:wid,delivery_kobo:500,published:true});
 await db.query("insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,'ACCT_serialStore','serial-store',$2)",[cid,actors.root]);
 black=await value(db,"insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,options,source_reference) values($1,$2,$3,'BLACK-001','{\"Colour\":\"Black\"}','VERIFIED-OPENING') returning id v",[cid,product,wid]);
 blue=await value(db,"insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,options,source_reference) values($1,$2,$3,'BLUE-001','{\"Colour\":\"Blue\"}','VERIFIED-OPENING') returning id v",[cid,product,wid]);
 await db.query("insert into tenant_tracking_products(company_id,product_id,mode,warranty_days) values($1,$2,'serial',365)",[cid,product]);
});
afterAll(async()=>db?.close());
it('reserves matching variant units once and rolls back an unavailable serialized variant',async()=>{
 await expect(checkout(input('Green'))).rejects.toThrow('serial units');
 expect(await value(db,'select reserved v from tenant_inventory where company_id=$1',[cid])).toBe(0);
 const data=input('Black'),order=await checkout(data);expect((await checkout(data)).id).toBe(order.id);expect(await state(black)).toBe('reserved');expect(await state(blue)).toBe('available');expect(order.items[0]).not.toHaveProperty('serials');
 const confirm=(amount=order.total_kobo)=>identity(db,'',()=>value<Order>(db,"select tenant_apply_payment($1,$2,'NGN','success','99887766') v",[order.reference,amount]),'service_role');
 await expect(confirm(order.total_kobo-1)).rejects.toThrow('verification mismatch');expect(await state(black)).toBe('reserved');
 const paid=await confirm();await confirm();expect(await state(black)).toBe('sold');expect(paid.items[0].serials).toEqual([{id:black,serial:'BLACK-001',imei:null}]);expect(JSON.stringify(paid)).not.toContain('acquisition_cost');
 expect(await value(db,"select count(*)::int v from tenant_serial_events where company_id=$1 and source_kind='online.verified-payment'",[cid])).toBe(1);expect(await value(db,'select warranty_until is not null v from tenant_serial_units where company_id=$1 and id=$2',[cid,black])).toBe(true);
});
it('releases the same identified unit on expiry without new physical stock and preserves immutable source history',async()=>{
 const before=await value<number>(db,'select on_hand v from tenant_inventory where company_id=$1',[cid]),data=input('Blue'),order=await checkout(data);expect(await state(blue)).toBe('reserved');
 await db.query("update orders set expires_at=now()-interval '1 second' where company_id=$1 and id=$2",[cid,order.id]);await identity(db,'',()=>db.query('select tenant_expire_pending()'),'service_role');
 expect(await state(blue)).toBe('available');expect(await value(db,'select on_hand v from tenant_inventory where company_id=$1',[cid])).toBe(before);expect(await value(db,'select reserved v from tenant_inventory where company_id=$1',[cid])).toBe(0);
 expect((await checkout(data)).status).toBe('expired');expect(await state(blue)).toBe('available');await expect(db.query('delete from tenant_serial_order_links where company_id=$1',[cid])).rejects.toThrow('immutable');
});
