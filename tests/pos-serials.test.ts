import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
type Sale={id:string;items:{id:string;serial_tracked:boolean;serials:{id:string;serial:string;identified_on_return:boolean}[]}[]};
let db:PGlite,cid:string,wid:string,product:string,session:string,oldSale:Sale,sale:Sale,otherSale:Sale;const units:string[]=[];
const pos=(action:string,data:unknown,key=randomUUID())=>identity(db,actors.a,()=>value<Sale>(db,'select tenant_pos_command($1,$2,$3,$4) v',[cid,key,action,data]));
const input=(ids:string[]|null,quantity=ids?.length||1)=>({warehouse_id:wid,session_id:session,channel:'pos',items:[{product_id:product,quantity,expected_price_kobo:10000,options:{},...(ids?{unit_ids:ids,expected_tracking_mode:'serial'}:{})}],tenders:[{method:'cash',amount_kobo:quantity*10000,received:true}]});
const stock=()=>value<number>(db,'select on_hand v from tenant_inventory where company_id=$1',[cid]);
const returnInput=(source:Sale,ids?:string[],newUnits?:{serial:string}[])=>({sale_id:source.id,session_id:session,verified:true,reason:'Physically inspected customer return against the original source',items:[{item_id:source.items[0].id,quantity:1,disposition:'resellable',...(ids?{unit_ids:ids}:{}),...(newUnits?{new_units:newUnits}:{})}],refund_confirmed:true,refund_method:'cash',reference:'SERIAL-REFUND-'+randomUUID()});
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','pos-serials');const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
 const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Main',branch_id:branch})).id;const category=(await commerce('category',{name:'Devices'})).id;product=(await commerce('product',{name:'Phone',slug:'phone',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;await db.query('update products set cost_kobo=6000 where id=$1',[product]);await commerce('stock',{warehouse_id:wid,product_id:product,delta:5,reason:'Verified stock before serial commissioning'});
 const register=await pos('register',{warehouse_id:wid,name:'Serial counter'});session=(await pos('open',{register_id:register.id,opening_kobo:0})).id;oldSale=await pos('sale',input(null,2));
 for(let i=1;i<=3;i++)units.push(await value(db,'insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,source_reference) values($1,$2,$3,$4,$5) returning id v',[cid,product,wid,`SERIAL-${i}`,'VERIFIED-OPENING']));
 await db.query("insert into tenant_tracking_products(company_id,product_id,mode,warranty_days) values($1,$2,'serial',365)",[cid,product]);
});
afterAll(async()=>db?.close());
it('reviews cached pre-tracking sales and requires one available identifier per sold unit',async()=>{
 await expect(pos('sale',input(null))).rejects.toThrow('review the cached sale');expect(await stock()).toBe(3);
 await expect(pos('sale',input([units[0],units[0]]))).rejects.toThrow('distinct');expect(await stock()).toBe(3);
 const key=randomUUID(),payload=input(units.slice(0,2));sale=await pos('sale',payload,key);expect(await pos('sale',payload,key)).toEqual(sale);expect(await stock()).toBe(1);expect(sale.items[0].serial_tracked).toBe(true);expect(sale.items[0].serials.map(u=>u.id).sort()).toEqual(units.slice(0,2).sort());expect(JSON.stringify(sale)).not.toContain('acquisition_cost');
 otherSale=await pos('sale',input([units[2]]));
});
it('inspects only the original sold units, preserves old receipts after resale and never returns one unit twice',async()=>{
 await expect(pos('return',returnInput(sale,[units[2]]))).rejects.toThrow('another sale');expect(await stock()).toBe(0);
 const key=randomUUID(),data=returnInput(sale,[units[0]]);const result=await pos('return',data,key);expect(await pos('return',data,key)).toEqual(result);expect(await stock()).toBe(1);await pos('sale',input([units[0]]));
 await expect(pos('return',returnInput(sale,[units[0]]))).rejects.toThrow('another sale');expect(await stock()).toBe(0);
 const receipt=await identity(db,actors.a,()=>value<Sale>(db,'select tenant_pos_get_sale($1,$2) v',[cid,sale.id]));expect(receipt.items[0].serials.map(u=>u.id).sort()).toEqual(units.slice(0,2).sort());expect(otherSale.items[0].serials[0].id).toBe(units[2]);
});
it('identifies historical returned units explicitly without inventing their original identities',async()=>{
 await expect(pos('return',returnInput(oldSale))).rejects.toThrow('historical sale');
 await pos('return',returnInput(oldSale,undefined,[{serial:'HISTORICAL-RETURN-1'}]));expect(await stock()).toBe(1);
 await expect(pos('return',returnInput(oldSale,undefined,[{serial:'HISTORICAL-RETURN-1'}]))).rejects.toThrow('tenant_serial_identity');expect(await stock()).toBe(1);
 await pos('return',returnInput(oldSale,undefined,[{serial:'HISTORICAL-RETURN-2'}]));expect(await stock()).toBe(2);
 const receipt=await identity(db,actors.a,()=>value<Sale>(db,'select tenant_pos_get_sale($1,$2) v',[cid,oldSale.id]));expect(receipt.items[0].serial_tracked).toBe(false);expect(receipt.items[0].serials).toHaveLength(2);expect(receipt.items[0].serials.every(u=>u.identified_on_return)).toBe(true);
 expect(await value(db,"select sum(debit_kobo-credit_kobo)::text v from tenant_journal_lines where company_id=$1 and account_code='1200'",[cid])).toBe('12000');
});
