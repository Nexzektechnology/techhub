import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company,FLAGSHIP} from './helpers/tenant-db';
import {businessCommand,businessFilters,pendingBusinessCommand,type BusinessSnapshot} from '../src/lib/business-os';

let db:PGlite,a:string,b:string,branch:string,otherBranch:string,warehouse:string,otherWarehouse:string,product:string,supplier:string,customer:string;
const cmd=(who:string,cid:string,action:string,data:unknown,key=randomUUID())=>identity(db,who,()=>value<{id:string;on_hand?:number}>(db,'select tenant_business_command($1,$2,$3,$4) v',[cid,key,action,data]));
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[a,action,data]));
const snapshot=(who=actors.a,cid=a,scope:string|null=null,q='',page=1)=>identity(db,who,()=>value<BusinessSnapshot>(db,'select tenant_business_snapshot($1,$2,$3,$4) v',[cid,scope,q,page]));
beforeAll(async()=>{
 db=await tenantDatabase();a=await company(db,'a','foundation-a');b=await company(db,'b','foundation-b');
 branch=(await commerce('branch',{name:'Lagos'})).id;otherBranch=(await commerce('branch',{name:'Abuja'})).id;
 warehouse=(await commerce('warehouse',{name:'Lagos warehouse',branch_id:branch})).id;
 otherWarehouse=(await commerce('warehouse',{name:'Abuja warehouse',branch_id:otherBranch})).id;
 const category=(await commerce('category',{name:'Electronics'})).id;
 product=(await commerce('product',{name:'Business phone',slug:'business-phone',category_id:category,price_kobo:10000,image:'/window.svg',options:{},active:true})).id;
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));
});
afterAll(async()=>db?.close());

it('creates and edits customers without creating Auth accounts or financial entries',async()=>{
 const key=randomUUID(),payload={name:'A customer',email:'customer@example.com',phone:'08012345678',address:'Lagos',notes:'Call on weekdays',active:true};
 const before=await value<number>(db,'select count(*)::int v from auth.users');
 const first=await cmd(actors.a,a,'customer',payload,key);customer=first.id;
 expect(await cmd(actors.a,a,'customer',payload,key)).toEqual(first);
 expect((await snapshot()).customer_count).toBe(1);
 expect(await value<number>(db,'select count(*)::int v from auth.users')).toBe(before);
 await cmd(actors.a,a,'customer',{...payload,id:customer,name:'Updated customer'});
 expect((await snapshot()).customers[0].name).toBe('Updated customer');
 await expect(cmd(actors.b,b,'customer',{...payload,id:customer})).rejects.toThrow('Customer unavailable');
 await expect(cmd(actors.a,a,'customer',{...payload,name:'Changed input'},key)).rejects.toThrow('Idempotency key');
});
it('extends existing suppliers rather than creating a second supplier directory',async()=>{
 supplier=(await cmd(actors.a,a,'supplier',{name:'Trusted supplier',email:'supply@example.com',active:true})).id;
 expect(await value<string>(db,'select name v from suppliers where company_id=$1 and id=$2',[a,supplier])).toBe('Trusted supplier');
 await expect(cmd(actors.b,b,'supplier',{id:supplier,name:'Hostile edit'})).rejects.toThrow('Supplier unavailable');
 await cmd(actors.a,a,'supplier',{id:supplier,name:'Trusted supplier',email:'supply@example.com',notes:'Verified vendor',active:true});
 expect((await snapshot()).supplier_count).toBe(1);
});
const master=()=>({id:product,sku:'PHONE-001',barcode:'1234567890123',cost_kobo:6000,wholesale_kobo:9000,minimum_price_kobo:7000,reorder_level:4,supplier_id:supplier});
it('maintains exact-kobo product master data and rejects cross-tenant suppliers',async()=>{
 await cmd(actors.a,a,'product-master',master());
 expect((await snapshot()).products[0]).toMatchObject(master());
 const foreign=(await cmd(actors.b,b,'supplier',{name:'Foreign supplier'})).id;
 await expect(cmd(actors.a,a,'product-master',{...master(),supplier_id:foreign})).rejects.toThrow('Supplier unavailable');
 await expect(cmd(actors.b,b,'product-master',master())).rejects.toThrow('Product unavailable');
 await expect(db.query('update products set supplier_id=$1 where company_id=$2 and id=$3',[foreign,a,product])).rejects.toThrow();
});
it('enforces case-insensitive SKU and tenant-local barcode uniqueness',async()=>{
 const category=await value<string>(db,'select category_id v from products where id=$1',[product]);
 const second=(await commerce('product',{name:'Second phone',slug:'second-phone',category_id:category,price_kobo:12000,image:'/window.svg',options:{},active:true})).id;
 await expect(cmd(actors.a,a,'product-master',{...master(),id:second,sku:'phone-001',barcode:'different'})).rejects.toThrow('business_product_sku');
 await expect(cmd(actors.a,a,'product-master',{...master(),id:second,sku:'PHONE-002'})).rejects.toThrow('business_product_barcode');
 await cmd(actors.a,a,'product-master',{...master(),id:second,sku:'PHONE-002',barcode:''});
});
it('records stock and the immutable receipt exactly once across repeated requests',async()=>{
 const key=randomUUID(),payload={warehouse_id:warehouse,product_id:product,delta:20,reason:'Verified opening receipt'};
 const first=await cmd(actors.a,a,'stock',payload,key);
 expect(first.on_hand).toBe(20);expect(await cmd(actors.a,a,'stock',payload,key)).toEqual(first);
 expect(await value<number>(db,'select count(*)::int v from stock_movements where company_id=$1 and command_id=$2',[a,key])).toBe(1);
 expect(await value<number>(db,"select count(*)::int v from platform_audit where company_id=$1 and action='business.stock' and detail->>'command'=$2",[a,key])).toBe(1);
 await expect(cmd(actors.a,a,'stock',{...payload,delta:21},key)).rejects.toThrow('different input');
 await expect(db.query('update stock_movements set quantity=99 where company_id=$1 and command_id=$2',[a,key])).rejects.toThrow('immutable');
 await expect(db.query('delete from tenant_business_commands where company_id=$1 and id=$2',[a,key])).rejects.toThrow('immutable');
});
it('keeps reserved stock unavailable and rolls back a failed command completely',async()=>{
 await db.query('update tenant_inventory set reserved=3 where company_id=$1 and warehouse_id=$2 and product_id=$3',[a,warehouse,product]);
 const key=randomUUID();await expect(cmd(actors.a,a,'stock',{warehouse_id:warehouse,product_id:product,delta:-18,reason:'Exceeds available quantity'},key)).rejects.toThrow('reserved');
 expect(await value<number>(db,'select count(*)::int v from tenant_business_commands where id=$1',[key])).toBe(0);
 expect((await snapshot()).metrics).toEqual({on_hand:20,reserved:3,available:17,low_stock:0});
 await cmd(actors.a,a,'stock',{warehouse_id:otherWarehouse,product_id:product,delta:2,reason:'Verified other branch receipt'});
 const filtered=await snapshot(actors.a,a,branch);expect(filtered.metrics.available).toBe(17);expect(filtered.warehouses.map(w=>w.id)).toEqual([warehouse]);
 expect((await snapshot(actors.a,a,otherBranch)).metrics).toEqual({on_hand:2,reserved:0,available:2,low_stock:1});
 expect((await snapshot()).attention.map(i=>i.warehouse_id)).toEqual([otherWarehouse]);
});
it('enforces scope on data and commands and keeps costs out of inventory-only snapshots',async()=>{
 const role=(await commerce('role',{name:'Storekeeper',permissions:['inventory.read','inventory.adjust'],active:true})).id;
 await commerce('binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:warehouse});
 const s=await snapshot(actors.staff);expect(s.inventory.every(i=>i.warehouse_id===warehouse)).toBe(true);expect(s.movements.every(i=>i.warehouse_id===warehouse)).toBe(true);
 expect(s.products).toEqual([]);expect(s.customers).toEqual([]);expect(s.suppliers).toEqual([]);expect(s.metrics.on_hand).toBe(20);
 await expect(snapshot(actors.staff,a,otherBranch)).rejects.toThrow('Forbidden');
 await expect(cmd(actors.staff,a,'stock',{warehouse_id:otherWarehouse,product_id:product,delta:1,reason:'Hostile branch write'})).rejects.toThrow('Forbidden');
 await expect(cmd(actors.staff,a,'customer',{name:'Unauthorized customer'})).rejects.toThrow('Forbidden');
 const old=await identity(db,actors.staff,()=>value<{products:Record<string,unknown>[]}>(db,'select tenant_commerce_snapshot($1) v',[a]));
 for(const p of old.products){expect(p).not.toHaveProperty('cost_kobo');expect(p).not.toHaveProperty('supplier_id');}
 await expect(identity(db,actors.staff,()=>db.query('select tenant_commerce_snapshot_pre_business($1,1)',[a]))).rejects.toThrow('permission denied');
});
it('rejects stale replay after permission revocation and reusing another actor’s key',async()=>{
 const key=randomUUID(),payload={warehouse_id:warehouse,product_id:product,delta:1,reason:'Staff stock adjustment'};
 await cmd(actors.staff,a,'stock',payload,key);
 await expect(cmd(actors.a,a,'stock',payload,key)).rejects.toThrow('different input');
 await db.query('update tenant_role_bindings set active=false where company_id=$1 and user_id=$2',[a,actors.staff]);
 await expect(cmd(actors.staff,a,'stock',payload,key)).rejects.toThrow('Forbidden');
});
it('rejects cross-tenant reads, direct browser writes and forged tenant settings',async()=>{
 await expect(snapshot(actors.b,a)).rejects.toThrow('Forbidden');
 expect((await snapshot(actors.b,b)).customers).toEqual([]);
 await identity(db,actors.b,async()=>{
  await db.query("select set_config('app.tenant_id',$1,false)",[a]);
  await expect(db.query('select * from tenant_customers')).rejects.toThrow('permission denied');
  await expect(db.query("insert into tenant_customers(company_id,name) values($1,'Hostile insert')",[a])).rejects.toThrow('permission denied');
 });
});
it('treats search literally and paginates without hiding the matching record count',async()=>{
 for(let i=0;i<26;i++)await cmd(actors.a,a,'customer',{name:`Pagination ${String(i).padStart(2,'0')}`});
 await cmd(actors.a,a,'customer',{name:'Literal 100% _ customer'});
 const first=await snapshot(actors.a,a,null,'Pagination',1),second=await snapshot(actors.a,a,null,'Pagination',2);
 expect(first.customers).toHaveLength(25);expect(second.customers).toHaveLength(1);expect(first.customer_count).toBe(26);
 expect(new Set([...first.customers,...second.customers].map(c=>c.id)).size).toBe(26);
 expect((await snapshot(actors.a,a,null,'% _')).customers).toHaveLength(1);
 expect((await snapshot(actors.a,a,null,'no such person')).customer_count).toBe(0);
});
it('validates privileged direct RPC input as well as HTTP input',async()=>{
 for(const payload of [{name:'x'},{name:'Valid',email:'not-an-email'},{name:'Valid',phone:'x'.repeat(41)},{name:'Valid',active:'yes'}])await expect(cmd(actors.a,a,'customer',payload)).rejects.toThrow('Invalid contact');
 await expect(cmd(actors.a,a,'product-master',{...master(),cost_kobo:1.5})).rejects.toThrow('Invalid product master');
 await expect(cmd(actors.a,a,'stock',{warehouse_id:warehouse,product_id:product,delta:0,reason:'No quantity'})).rejects.toThrow('Invalid stock adjustment');
 await expect(identity(db,actors.a,()=>db.query('select tenant_business_command($1,null,$2,$3)',[a,'customer',{name:'Null key'}]))).rejects.toThrow('Invalid command');
 await expect(snapshot(actors.a,a,null,'',0)).rejects.toThrow('Invalid filters');
});
it('keeps the flagship write boundary and disabled commerce entitlements intact',async()=>{
 await expect(cmd(actors.root,FLAGSHIP,'customer',{name:'Flagship test'})).rejects.toThrow();
 await db.query("update platform_modules set enabled=false where company_id=$1 and module='commerce'",[b]);
 await expect(cmd(actors.b,b,'customer',{name:'Disabled commerce'})).rejects.toThrow('Forbidden');
 await expect(snapshot(actors.b,b)).rejects.toThrow('Forbidden');
});
it('retains read-only data while rejecting new business writes after cancellation',async()=>{
 await db.query("insert into saas_subscriptions(company_id,plan_id,state,period_end,grace_days) values($1,'starter','cancelled',now()-interval '30 days',0) on conflict(company_id) do update set state='cancelled',period_end=now()-interval '30 days',grace_days=0",[a]);
 expect((await snapshot()).access).toBe('read_only');
 await expect(cmd(actors.a,a,'customer',{name:'Suspended write'})).rejects.toThrow('read-only');
});
it('validates contracts and preserves retry identity until the payload changes',()=>{
 const input={action:'stock' as const,data:{warehouse_id:'warehouse',product_id:'product',delta:2,reason:'Verified adjustment'}};
 const first=pendingBusinessCommand(null,input);expect(pendingBusinessCommand(first,input)).toBe(first);
 expect(pendingBusinessCommand(first,{...input,data:{...input.data,delta:3}}).key).not.toBe(first.key);
 expect(businessCommand.safeParse({...first,data:{...input.data,delta:1.5}}).success).toBe(false);
 expect(businessCommand.safeParse({...first,data:{...input.data,company_id:b}}).success).toBe(false);
 expect(businessFilters.safeParse({page:0}).success).toBe(false);
 expect(businessFilters.parse({branch:''}).branch).toBeUndefined();
});
