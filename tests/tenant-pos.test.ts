import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,a:string,b:string,wid:string,otherWid:string,product:string,register:string,session:string,customer:string,sale:string,creditSale:string;
const cmd=(action:string,data:unknown,key=randomUUID(),who=actors.a,cid=a)=>identity(db,who,()=>value<Record<string,unknown>>(db,'select tenant_pos_command($1,$2,$3,$4) v',[cid,key,action,data]));
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[a,action,data]));
const stock=()=>value<number>(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2 and product_id=$3',[a,wid,product]);
const input=(quantity=2,tenders:unknown[]=[{method:'cash',amount_kobo:20000,received:true}])=>({warehouse_id:wid,session_id:session,channel:'pos',items:[{product_id:product,quantity,expected_price_kobo:10000,options:{}}],tenders});
beforeAll(async()=>{
 db=await tenantDatabase();a=await company(db,'a','pos-a');b=await company(db,'b','pos-b');
 const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Main',branch_id:branch})).id;
 const other=(await commerce('branch',{name:'Abuja'})).id;otherWid=(await commerce('warehouse',{name:'Restricted',branch_id:other})).id;
 const category=(await commerce('category',{name:'Foods'})).id;product=(await commerce('product',{name:'Rice',slug:'rice',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
 await commerce('stock',{warehouse_id:wid,product_id:product,delta:30,reason:'Verified opening stock'});
 register=String((await cmd('register',{warehouse_id:wid,name:'Front register'})).id);
 session=String((await cmd('open',{register_id:register,opening_kobo:5000})).id);
 customer=await identity(db,actors.a,()=>value<string>(db,"select tenant_business_command($1,$2,'customer',$3)->>'id' v",[a,randomUUID(),{name:'Credit buyer'}]));
});
afterAll(async()=>db?.close());
it('opens one cashier session per register and rejects overlapping sessions',async()=>{
 await expect(cmd('open',{register_id:register,opening_kobo:0})).rejects.toThrow('tenant_register_open');
});
it('sells for cash once, snapshots prices and cost, and preserves ecommerce reservations',async()=>{
 await db.query('update tenant_inventory set reserved=3 where company_id=$1 and warehouse_id=$2',[a,wid]);
 const key=randomUUID(),payload=input();const first=await cmd('sale',payload,key);sale=String(first.id);
 expect(first).toMatchObject({status:'paid',total_kobo:20000,paid_kobo:20000,balance_kobo:0});expect(await stock()).toBe(28);
 expect(await cmd('sale',payload,key)).toEqual(first);expect(await stock()).toBe(28);
 expect(first.items).toEqual(expect.arrayContaining([expect.objectContaining({quantity:2,price_kobo:10000})]));
 expect((first.items as Record<string,unknown>[])[0]).not.toHaveProperty('unit_cost_kobo');
 await expect(cmd('sale',{...payload,channel:'direct'},key)).rejects.toThrow('Idempotency key');
 expect(await value<number>(db,'select reserved v from tenant_inventory where company_id=$1 and warehouse_id=$2',[a,wid])).toBe(3);
});
it('supports exact split tender and rejects duplicate bank references or unconfirmed payments',async()=>{
 const tenders=[{method:'cash',amount_kobo:5000,received:true},{method:'bank_transfer',amount_kobo:5000,reference:'BANK-123456',received:true}];
 expect(await cmd('sale',input(1,tenders))).toMatchObject({method:'split',status:'paid',total_kobo:10000});
 const before=await stock();await expect(cmd('sale',input(1,tenders))).rejects.toThrow('tenant_tender_external_reference');expect(await stock()).toBe(before);
 await expect(cmd('sale',input(1,[{method:'cash',amount_kobo:10000,received:false}]))).rejects.toThrow('actually received');
 await expect(cmd('sale',input(1,[{method:'cash',amount_kobo:11000,received:true}]))).rejects.toThrow('exact amount');
});
it('enforces credit limits and allocates partial then full customer payments',async()=>{
 const payload={...input(1,[]),customer_id:customer};
 await expect(cmd('sale',payload)).rejects.toThrow('credit limit');
 await cmd('credit',{customer_id:customer,limit_kobo:15000,terms_days:14});
 const first=await cmd('sale',payload);creditSale=String(first.id);expect(first).toMatchObject({status:'credit',balance_kobo:10000});
 await expect(cmd('sale',payload)).rejects.toThrow('credit limit');
 const payment={sale_id:creditSale,session_id:session,tenders:[{method:'cash',amount_kobo:4000,received:true}]};
 const key=randomUUID();expect(await cmd('payment',payment,key)).toMatchObject({status:'partially_paid',balance_kobo:6000});
 expect(await cmd('payment',payment,key)).toMatchObject({balance_kobo:6000});
 await expect(cmd('payment',{...payment,tenders:[{method:'cash',amount_kobo:7000,received:true}]})).rejects.toThrow('outstanding balance');
 expect(await cmd('payment',{...payment,tenders:[{method:'cash',amount_kobo:6000,received:true}]})).toMatchObject({status:'paid',balance_kobo:0});
});
it('requires finance approval for prices below configured margin protection',async()=>{
 await db.query('update products set minimum_price_kobo=9000 where id=$1',[product]);
 const payload=input(1,[{method:'cash',amount_kobo:8000,received:true}]);Object.assign(payload.items[0],{unit_price_kobo:8000});
 await expect(cmd('sale',payload)).rejects.toThrow('finance approval');
 expect(await cmd('sale',{...payload,approval_note:'Owner approved damaged packaging discount'})).toMatchObject({total_kobo:8000,discount_kobo:2000});
});
it('holds carts without reserving stock and revalidates prices when resumed',async()=>{
 const before=await stock();const held=await cmd('hold',{...input(),label:'Customer collecting later'});expect(await stock()).toBe(before);
 const payload={...input(),hold_id:held.id};payload.items[0].expected_price_kobo=1;await expect(cmd('sale',payload)).rejects.toThrow('Prices changed');
 expect(await cmd('sale',{...input(),hold_id:held.id})).toMatchObject({status:'paid'});
 expect(await value<number>(db,'select count(*)::int v from tenant_pos_holds where company_id=$1',[a])).toBe(0);
});
it('accepts only verified returns, restores resellable goods, and prevents repeated returns',async()=>{
 const item=await value<string>(db,'select id v from pos_items where sale_id=$1',[sale]);const before=await stock();
 const payload={sale_id:sale,session_id:session,verified:true,reason:'Customer returned unopened goods',items:[{item_id:item,quantity:1,disposition:'resellable'}],refund_method:'cash',refund_confirmed:true,reference:'RETURN-123456'};
 await expect(cmd('return',{...payload,verified:false})).rejects.toThrow('Verify returned goods');
 const key=randomUUID();expect(await cmd('return',payload,key)).toMatchObject({returned_kobo:10000});expect(await stock()).toBe(before+1);
 await cmd('return',payload,key);expect(await stock()).toBe(before+1);
 await expect(cmd('return',{...payload,reference:'RETURN-123457',items:[{item_id:item,quantity:2,disposition:'resellable'}]})).rejects.toThrow('sold quantity');
 await cmd('return',{...payload,reference:'RETURN-123458',items:[{item_id:item,quantity:1,disposition:'damaged'}]});expect(await stock()).toBe(before+1);
 await expect(db.query('delete from tenant_pos_return_items where company_id=$1',[a])).rejects.toThrow('immutable');
});
it('calculates configured tax on the server and snapshots the version',async()=>{
 await cmd('tax',{tax_bps:750,label:'Configured sales tax'});
 expect(await cmd('sale',input(1,[{method:'cash',amount_kobo:10750,received:true}]))).toMatchObject({total_kobo:10750,tax_kobo:750,tax_version:1});
 await cmd('tax',{tax_bps:0,label:'No configured tax'});
});
it('isolates tenant and branch POS records from staff and legacy administrators',async()=>{
 await expect(cmd('sale',input(),randomUUID(),actors.b,b)).rejects.toThrow();
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));
 const role=(await commerce('role',{name:'Cashier',permissions:['orders.read','orders.manage']})).id;await commerce('binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:wid});
 await expect(cmd('hold',{warehouse_id:otherWid,label:'Hostile branch',items:input().items},randomUUID(),actors.staff)).rejects.toThrow('Forbidden');
 const s=await identity(db,actors.staff,()=>value<{sales:{warehouse_id:string}[];warehouses:{id:string}[]}>(db,'select tenant_pos_snapshot($1) v',[a]));expect(s.warehouses.map(w=>w.id)).toEqual([wid]);expect(s.sales.every(sale=>sale.warehouse_id===wid)).toBe(true);
 await db.query("update profiles set role='admin' where id=$1",[actors.root]);
 await identity(db,actors.root,async()=>{expect((await db.query('select * from pos_sales where company_id=$1',[a])).rows).toHaveLength(0);await expect(db.query('select claim_pos_initialization($1)',[sale])).rejects.toThrow();});
 await expect(identity(db,actors.staff,()=>db.query('update pos_sales set paid_kobo=0 where id=$1',[sale]))).rejects.toThrow('permission denied');
});
it('closes the cash drawer with an explicit counted amount and variance',async()=>{
 const expected=await value<number>(db,"select 5000+coalesce((select sum(amount_kobo) from tenant_pos_tenders where session_id=$1 and method='cash'),0)-coalesce((select sum(refund_kobo) from tenant_pos_returns where session_id=$1 and refund_method='cash'),0) v",[session]);
 expect(await cmd('close',{session_id:session,counted_kobo:Number(expected)-100,note:'Counted drawer with supervisor'})).toMatchObject({expected_kobo:Number(expected),variance_kobo:-100});
 await expect(cmd('sale',input())).rejects.toThrow('open cashier session');
});
