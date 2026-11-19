import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';

it('upgrades populated stock and pending orders while preserving an older whole-row storefront view interface',async()=>{
 const db=await tenantDatabase(62);
 try{
  const cid=await company(db,'a','upgrade-company');
  const cmd=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
  const branch=(await cmd('branch',{name:'Existing branch'})).id;
  const warehouse=(await cmd('warehouse',{name:'Existing warehouse',branch_id:branch})).id;
  const category=(await cmd('category',{name:'Existing category'})).id;
  const product=(await cmd('product',{name:'Existing rice',slug:'existing-rice',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
  await cmd('stock',{warehouse_id:warehouse,product_id:product,delta:10,reason:'Existing verified opening stock'});
  await cmd('storefront',{warehouse_id:warehouse,delivery_kobo:0,published:true});
  await db.query("insert into suppliers(company_id,id,name,email) values($1,'upgrade-supplier','Existing supplier','supplier@example.com')",[cid]);
  await db.query("insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,'ACCT_upgrade','upgrade-company',$2)",[cid,actors.root]);
  const order=await identity(db,actors.customer,()=>value<{id:string;reference:string;total_kobo:number}>(db,'select tenant_checkout($1,$2) v',['upgrade-company',{key:randomUUID(),items:[{product_id:product,quantity:2,expected_price_kobo:10000,options:{}}],address:{name:'Existing customer',email:'customer@tenant.example',phone:'08012345678',street:'123 Existing Street',city:'Lagos',state:'Lagos'},coupon:''}]));
  // Isolated fixture only: reconstruct the former row-type-dependent view.
  await db.exec(`drop view storefront_products;
   create view storefront_products with(security_invoker=true) as
   select (jsonb_populate_record(null::products,to_jsonb(p)||jsonb_build_object('price_kobo',coalesce(effective_product_price(p.id),p.price_kobo),'previous_price_kobo',case when effective_product_price(p.id)<p.price_kobo then p.price_kobo else p.previous_price_kobo end))).*,p.price_kobo as regular_price_kobo from products p;
   grant select on storefront_products to anon,authenticated;`);
  const columns=()=>value<string[]>(db,"select array_agg(attname order by attnum) v from pg_attribute where attrelid='storefront_products'::regclass and attnum>0 and not attisdropped");
  const metadata=()=>value(db,"select jsonb_build_object('owner',relowner,'options',reloptions,'grants',relacl::text) v from pg_class where oid='storefront_products'::regclass");
  const beforeColumns=await columns(),beforeMetadata=await metadata();
  await db.exec(readFileSync('supabase/migrations/063_business_foundation.sql','utf8'));
  expect(await columns()).toEqual(beforeColumns);expect(await metadata()).toEqual(beforeMetadata);
  expect(await columns()).not.toContain('cost_kobo');
  expect(await value(db,"select is_updatable v from information_schema.views where table_schema='public' and table_name='storefront_products'")).toBe('NO');
  expect(await value(db,'select jsonb_build_object(\'on_hand\',on_hand,\'reserved\',reserved) v from tenant_inventory where company_id=$1 and product_id=$2',[cid,product])).toEqual({on_hand:10,reserved:2});
  expect(await value(db,"select name v from suppliers where company_id=$1 and id='upgrade-supplier'",[cid])).toBe('Existing supplier');
  expect(await value(db,'select payment_status v from orders where id=$1',[order.id])).toBe('pending');
  await identity(db,'',()=>db.query("select tenant_apply_payment($1,$2,'NGN','success','991991')",[order.reference,order.total_kobo]),'service_role');
  expect(await value(db,'select jsonb_build_object(\'on_hand\',on_hand,\'reserved\',reserved) v from tenant_inventory where company_id=$1 and product_id=$2',[cid,product])).toEqual({on_hand:8,reserved:0});
  expect(await value(db,'select count(*)::int v from stock_movements where company_id=$1',[cid])).toBe(2);
  const key=randomUUID();await identity(db,actors.a,()=>db.query("select tenant_business_command($1,$2,'stock',$3)",[cid,key,{warehouse_id:warehouse,product_id:product,delta:3,reason:'Verified post-upgrade receipt'}]));
  expect(await value(db,'select on_hand v from tenant_inventory where company_id=$1 and product_id=$2',[cid,product])).toBe(11);
 }finally{await db.close();}
});
