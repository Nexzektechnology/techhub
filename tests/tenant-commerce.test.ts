import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
import {restoreShopping} from '../src/lib/shopping-storage';
let db:PGlite,a:string,b:string,branch:string,warehouse:string,otherWarehouse:string,product:string,categoryId:string;
const command=(actor:string,cid:string,action:string,data:unknown)=>identity(db,actor,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
beforeAll(async()=>{
 db=await tenantDatabase();a=await company(db,'a','tenant-a');b=await company(db,'b','tenant-b');
 branch=(await command(actors.a,a,'branch',{name:'Lagos branch',address:'Lagos'})).id;
 warehouse=(await command(actors.a,a,'warehouse',{name:'Lagos warehouse',branch_id:branch,address:'Lagos'})).id;
 const otherBranch=(await command(actors.a,a,'branch',{name:'Abuja branch'})).id;otherWarehouse=(await command(actors.a,a,'warehouse',{name:'Abuja warehouse',branch_id:otherBranch,address:'Abuja'})).id;
 categoryId=(await command(actors.a,a,'category',{name:'Foods'})).id;
 product=(await command(actors.a,a,'product',{name:'Tenant rice',slug:'rice',category_id:categoryId,price_kobo:10000,image:'https://example.com/rice.webp',active:true,options:{},description:'Rice'})).id;
 await command(actors.a,a,'stock',{warehouse_id:warehouse,product_id:product,delta:20,reason:'Opening verified stock'});
 await command(actors.a,a,'stock',{warehouse_id:otherWarehouse,product_id:product,delta:50,reason:'Opening verified stock'});
 await command(actors.a,a,'storefront',{warehouse_id:warehouse,delivery_kobo:5000,published:true});
 await db.query("insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,'ACCT_testA','tenant-a',$2)",[a,actors.root]);
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));
});
afterAll(async()=>db?.close());
it('assigns immutable tenant labels and resolves only active, published storefronts without exposing domain administration',async()=>{
 expect(await identity(db,'',()=>value(db,"select saas_resolve_subdomain('tenant-a') v"),'anon')).toBe('tenant-a');
 expect(await identity(db,'',()=>value(db,"select saas_resolve_subdomain('tenant-b') v"),'anon')).toBeNull();
 await identity(db,actors.b,async()=>{
  expect((await db.query('select label from saas_subdomains where company_id=$1',[a])).rows).toHaveLength(0);
  await expect(db.query("update saas_subdomains set label='hijack' where company_id=$1",[a])).rejects.toThrow('permission denied');
  await expect(db.query("insert into saas_subdomains(company_id,label) values($1,'hijack')",[b])).rejects.toThrow('permission denied');
 });
 await db.query('update tenant_storefronts set published=false where company_id=$1',[a]);
 expect(await identity(db,'',()=>value(db,"select saas_resolve_subdomain('tenant-a') v"),'anon')).toBeNull();
 await db.query('update tenant_storefronts set published=true where company_id=$1',[a]);
 await db.query('update platform_companies set active=false where id=$1',[a]);
 expect(await identity(db,'',()=>value(db,"select saas_resolve_subdomain('tenant-a') v"),'anon')).toBeNull();
 await db.query('update platform_companies set active=true where id=$1',[a]);
 await expect(db.query("update saas_subdomains set label='app' where company_id=$1",[a])).rejects.toThrow();
 expect(await identity(db,'',()=>value(db,"select saas_resolve_subdomain('tenant-a') v"),'anon')).toBe('tenant-a');
});
it('enforces company isolation in reads, writes, deletes, foreign keys and legacy administrator functions',async()=>{
 await expect(command(actors.b,a,'stock',{warehouse_id:warehouse,product_id:product,delta:1,reason:'Cross company attack'})).rejects.toThrow('Forbidden');
 await expect(command(actors.b,b,'product',{name:'Foreign category',slug:'foreign',category_id:categoryId,price_kobo:100,image:'https://example.com/a.png'})).rejects.toThrow('Category unavailable');
 await identity(db,actors.b,async()=>{expect((await db.query('select * from products where id=$1',[product])).rows).toHaveLength(0);await expect(db.query('delete from products where id=$1',[product])).rejects.toThrow('permission denied');expect(await value<boolean>(db,"select pg_has_role('authenticated','edge_tenant_executor','MEMBER') v")).toBe(false);});
 await db.query("update profiles set role='admin' where id=$1",[actors.root]);
 await identity(db,actors.root,async()=>{expect((await db.query('select * from products where id=$1',[product])).rows).toHaveLength(0);await expect(db.query('select adjust_stock($1,1,$2)',[product,'Legacy cross-tenant attack'])).rejects.toThrow();});
});
it('requires explicit warehouse grants and never expands a staff member to other branches',async()=>{
 await expect(command(actors.staff,a,'stock',{warehouse_id:warehouse,product_id:product,delta:1,reason:'No assignment yet'})).rejects.toThrow('Forbidden');
 const role=(await command(actors.a,a,'role',{name:'Warehouse officer',permissions:['catalogue.read','inventory.read','inventory.adjust'],active:true})).id;
 await command(actors.a,a,'binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:warehouse});
 await command(actors.staff,a,'stock',{warehouse_id:warehouse,product_id:product,delta:1,reason:'Authorized warehouse receipt'});
 await expect(command(actors.staff,a,'stock',{warehouse_id:otherWarehouse,product_id:product,delta:1,reason:'Other warehouse attack'})).rejects.toThrow('Forbidden');
 const snapshot=await identity(db,actors.staff,()=>value<{warehouses:{id:string}[];products:{stock:number}[];inventory:{warehouse_id:string}[]}>(db,'select tenant_commerce_snapshot($1) v',[a]));
 expect(snapshot.warehouses.map(w=>w.id)).toEqual([warehouse]);expect(snapshot.inventory.every(i=>i.warehouse_id===warehouse)).toBe(true);expect(snapshot.products[0].stock).toBe(21);
});
it('serves only published company products and isolates public stock to the fulfilment warehouse',async()=>{
 const s=await identity(db,'',()=>value<{products:{id:string;stock:number}[];company:{id:string}}>(db,'select tenant_storefront($1) v',['tenant-a']),'anon');expect(s.company.id).toBe(a);expect(s.products[0]).toMatchObject({id:product,stock:21});
 await expect(identity(db,'',()=>db.query('select tenant_storefront($1)',['tenant-b']),'anon')).rejects.toThrow('Store unavailable');
 expect(await value(db,"select nullif(current_setting('app.tenant_id',true),'') v")).toBeNull();
});
const checkout=()=>({key:randomUUID(),items:[{product_id:product,quantity:2,expected_price_kobo:10000,options:{}}],address:{name:'Customer name',email:'customer@tenant.example',street:'123 Customer Street',phone:'08012345678',city:'Lagos',state:'Lagos'},coupon:''});
it('reserves warehouse stock once and rejects cross-company products, stale prices and excess quantities',async()=>{
 const input=checkout();const first=await identity(db,actors.customer,()=>value<{id:string;reference:string;total_kobo:number}>(db,'select tenant_checkout($1,$2) v',['tenant-a',input]));
 const again=await identity(db,actors.customer,()=>value<{id:string}>(db,'select tenant_checkout($1,$2) v',['tenant-a',input]));expect(again.id).toBe(first.id);expect(first.total_kobo).toBe(25000);
 await db.query("update tenant_payment_accounts set subaccount_code='ACCT_replacement' where company_id=$1",[a]);
 expect(await identity(db,'',()=>value(db,'select tenant_payment_context($1) v',[first.reference]),'service_role')).toMatchObject({subaccount:'ACCT_testA'});
 await db.query("update tenant_payment_accounts set subaccount_code='ACCT_testA' where company_id=$1",[a]);
 const bad=checkout();bad.items[0].expected_price_kobo=1;await expect(identity(db,actors.customer,()=>db.query('select tenant_checkout($1,$2)',['tenant-a',bad]))).rejects.toThrow('Prices changed');
 const excessive=checkout();excessive.items[0].quantity=50;await expect(identity(db,actors.customer,()=>db.query('select tenant_checkout($1,$2)',['tenant-a',excessive]))).rejects.toThrow('Insufficient stock');
 await expect(identity(db,actors.b,()=>db.query('select tenant_my_order($1,$2)',['tenant-a',first.reference]))).rejects.toThrow('Forbidden');
 const paid=()=>identity(db,'',()=>value<{payment_status:string}>(db,"select tenant_apply_payment($1,$2,'NGN','success','9911') v",[first.reference,first.total_kobo]),'service_role');expect(await paid()).toMatchObject({payment_status:'paid'});expect(await paid()).toMatchObject({payment_status:'paid'});
 expect(await value<number>(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2 and product_id=$3',[a,warehouse,product])).toBe(19);
});
it('keeps payment application service-only and releases expired reservations without consuming stock',async()=>{
 const input=checkout();const o=await identity(db,actors.customer,()=>value<{id:string;reference:string;total_kobo:number}>(db,'select tenant_checkout($1,$2) v',['tenant-a',input]));
 await expect(identity(db,actors.a,()=>db.query("select tenant_apply_payment($1,$2,'NGN','success','9912')",[o.reference,o.total_kobo]))).rejects.toThrow('permission denied');
 await db.query("update orders set expires_at=now()-interval '1 minute' where id=$1",[o.id]);await identity(db,'',()=>db.query('select tenant_expire_pending()'),'service_role');
 expect(await value<string>(db,'select status v from orders where id=$1',[o.id])).toBe('expired');
 await expect(identity(db,'',()=>db.query("select tenant_apply_payment($1,$2,'NGN','success','9912')",[o.reference,o.total_kobo]),'service_role')).rejects.toThrow('reconciliation');
});
it('keeps unbranded products in restored bags and ignores archived flagship directory names',async()=>{
 await db.query("insert into brands(id,name,archived_at,active) values('flagship-archived-brand','Shared brand',now(),false)");
 const p=(await command(actors.a,a,'product',{name:'Unbranded item',slug:'unbranded-item',category_id:categoryId,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
 await command(actors.a,a,'stock',{warehouse_id:warehouse,product_id:p,delta:3,reason:'Opening verified stock'});
 type Store={products:Record<string,unknown>[]};const store=await identity(db,'',()=>value<Store>(db,'select tenant_storefront($1) v',['tenant-a']),'anon');const publicProduct=store.products.find(item=>item.id===p)!;
 expect(publicProduct.brand).toBeTruthy();expect(publicProduct.description).toBeTruthy();expect(restoreShopping(JSON.stringify({cart:[{key:p,product:publicProduct,quantity:1,options:{}}],wishlist:[]})).cart).toHaveLength(1);
 await command(actors.a,a,'product',{id:p,name:'Renamed item',slug:'renamed-item',category_id:categoryId,price_kobo:10000,image:'/window.svg',active:true,options:{}});
 await expect(command(actors.a,a,'product',{name:'Reused product URL',slug:'unbranded-item',category_id:categoryId,price_kobo:10000,image:'/window.svg',active:true,options:{}})).resolves.toHaveProperty('id');
 await expect(command(actors.a,a,'product',{name:'Shared brand item',slug:'shared-brand-item',brand:'Shared brand',category_id:categoryId,price_kobo:10000,image:'/window.svg',active:true,options:{}})).resolves.toHaveProperty('id');
 await db.query('update categories set archived_at=now() where id=$1',[categoryId]);
 await expect(command(actors.a,a,'product',{name:'Archived category attack',slug:'archived-category-item',category_id:categoryId,price_kobo:10000,image:'/window.svg',active:true,options:{}})).rejects.toThrow('Category unavailable');
});
it('revokes warehouse access immediately when its branch is disabled',async()=>{
 await db.query('update tenant_branches set active=false where company_id=$1 and id=$2',[a,branch]);
 await expect(command(actors.staff,a,'stock',{warehouse_id:warehouse,product_id:product,delta:1,reason:'Inactive branch attack'})).rejects.toThrow('Forbidden');
 const snapshot=await identity(db,actors.staff,()=>value<{inventory:unknown[]}>(db,'select tenant_commerce_snapshot($1) v',[a]));expect(snapshot.inventory).toHaveLength(0);
});
it('prevents delegated managers from granting broader authority or changing their own assignments',async()=>{
 const role=(await command(actors.a,a,'role',{name:'Team delegate',permissions:['team.manage'],active:true})).id;
 await command(actors.a,a,'binding',{user_id:actors.staff,role_id:role,scope:'company'});
 await expect(command(actors.staff,a,'role',{name:'Escalation attempt',permissions:['team.manage','inventory.read','inventory.adjust'],active:true})).rejects.toThrow('beyond your own company authority');
 await expect(command(actors.staff,a,'binding',{user_id:actors.staff,role_id:role,scope:'company'})).rejects.toThrow('Self permission changes');
});
it('restricts operational health to an MFA platform owner and reports intact SQL boundaries',async()=>{
 await expect(identity(db,actors.a,()=>db.query('select saas_operational_health()'))).rejects.toThrow('Forbidden');
 await expect(identity(db,actors.root,()=>db.query('select saas_operational_health()'))).rejects.toThrow('Forbidden');
 const health=await identity(db,actors.root,()=>value(db,'select saas_operational_health() v'),'authenticated','aal2');expect(health).toMatchObject({unsafe_worker_grants:false,tables_without_rls:0,unvalidated_foreign_keys:0,legacy_routine_boundary_violations:0});
});
it('keeps temporary tables from shadowing trusted profile or commerce lookups',async()=>{
 await identity(db,actors.a,async()=>{
  await db.exec('create temp table profiles(id uuid,role text);create temp table products(id text)');
  try{
   await db.query("insert into pg_temp.profiles values($1,'admin')",[actors.a]);expect(await value(db,'select app_role() v')).toBe('customer');
   const s=await value<{company_id:string;products:{company_id:string}[]}>(db,'select tenant_commerce_snapshot($1) v',[a]);expect(s.company_id).toBe(a);expect(s.products.every(p=>p.company_id===a)).toBe(true);
   expect(await value<boolean>(db,"select has_function_privilege('authenticated','tenant_settlement_subaccount(uuid)','EXECUTE') v")).toBe(false);
  }finally{await db.exec('drop table pg_temp.profiles;drop table pg_temp.products');}
 });
});
