import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,cid:string,wid:string,product:string,session:string,customer:string,sale:string;
const pos=(action:string,data:unknown,key=randomUUID())=>identity(db,actors.a,()=>value<Record<string,unknown>>(db,'select tenant_pos_command($1,$2,$3,$4) v',[cid,key,action,data]));
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
const balance=(code:string)=>value<number>(db,'select coalesce(sum(debit_kobo-credit_kobo),0)::bigint v from tenant_journal_lines where company_id=$1 and account_code=$2',[cid,code]).then(Number);
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','ledger-a');const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Main warehouse',branch_id:branch})).id;
 const category=(await commerce('category',{name:'Foods'})).id;product=(await commerce('product',{name:'Rice',slug:'rice',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
 await db.query('update products set cost_kobo=6000 where id=$1',[product]);
 await db.query('insert into tenant_inventory(company_id,warehouse_id,product_id,on_hand) values($1,$2,$3,10)',[cid,wid,product]);
 const register=await pos('register',{warehouse_id:wid,name:'Counter'});session=String((await pos('open',{register_id:register.id,opening_kobo:0})).id);
 customer=await identity(db,actors.a,()=>value<string>(db,"select tenant_business_command($1,$2,'customer',$3)->>'id' v",[cid,randomUUID(),{name:'Credit customer'}]));
 await pos('credit',{customer_id:customer,limit_kobo:50000,terms_days:14});
});
afterAll(async()=>db?.close());
const input=(paid=10000)=>({warehouse_id:wid,session_id:session,channel:'pos',customer_id:customer,items:[{product_id:product,quantity:1,expected_price_kobo:10000,options:{}}],tenders:paid?[{method:'cash',amount_kobo:paid,received:true}]:[]});
it('posts opening inventory, revenue, cash and cost of goods in balanced source-linked journals',async()=>{
 const key=randomUUID(),result=await pos('sale',input(),key);sale=String(result.id);
 expect(await balance('1200')).toBe(54000);expect(await balance('3000')).toBe(-60000);expect(await balance('1000')).toBe(10000);expect(await balance('4000')).toBe(-10000);expect(await balance('5000')).toBe(6000);
 expect(await value(db,'select count(*)::int v from tenant_journals where company_id=$1',[cid])).toBe(2);
 await pos('sale',input(),key);expect(await balance('4000')).toBe(-10000);
 expect(await value(db,'select count(*)::int v from(select journal_id from tenant_journal_lines where company_id=$1 group by journal_id having sum(debit_kobo)<>sum(credit_kobo)) broken',[cid])).toBe(0);
});
it('posts credit receivables and partial/full collections without recognizing revenue again',async()=>{
 const credit=await pos('sale',input(0));expect(await balance('1100')).toBe(10000);expect(await balance('4000')).toBe(-20000);
 await pos('payment',{sale_id:credit.id,session_id:session,tenders:[{method:'bank_transfer',amount_kobo:4000,reference:'LEDGER-BANK-001',received:true}]});
 expect(await balance('1100')).toBe(6000);expect(await balance('1010')).toBe(4000);expect(await balance('4000')).toBe(-20000);
 await pos('payment',{sale_id:credit.id,session_id:session,tenders:[{method:'cash',amount_kobo:6000,received:true}]});expect(await balance('1100')).toBe(0);
});
it('posts an inspected return, cash refund and cost reversal atomically',async()=>{
 const item=await value<string>(db,'select id v from pos_items where sale_id=$1',[sale]);
 await pos('return',{sale_id:sale,session_id:session,verified:true,reason:'Inspected unopened customer return',items:[{item_id:item,quantity:1,disposition:'resellable'}],refund_confirmed:true,refund_method:'cash',reference:'LEDGER-RETURN-001'});
 expect(await balance('4100')).toBe(10000);expect(await balance('5000')).toBe(6000);expect(await balance('1200')).toBe(54000);expect(await balance('1000')).toBe(6000);
});
it('rejects unbalanced journals at posting and at the independent deferred constraint',async()=>{
 await expect(db.query("select tenant_finance_post($1,'manual','bad',current_date,null,'Unbalanced test journal',$2)",[cid,[{account:'1000',debit:100,credit:0},{account:'3000',debit:0,credit:99}]])).rejects.toThrow('balance');
 const period=await value<string>(db,'select id v from tenant_accounting_periods where company_id=$1 limit 1',[cid]);
 await expect(db.query("insert into tenant_journals(company_id,entry_date,period_id,source_kind,source_id,description,fingerprint) values($1,current_date,$2,'manual','empty','Empty journal attempt','test')",[cid,period])).rejects.toThrow('balanced');
});
it('keeps posted entries immutable and denies direct browser ledger access',async()=>{
 await expect(db.query('update tenant_journal_lines set debit_kobo=999 where company_id=$1',[cid])).rejects.toThrow('immutable');
 await expect(db.query('delete from tenant_journals where company_id=$1',[cid])).rejects.toThrow('immutable');
 await identity(db,actors.a,async()=>{await expect(db.query('select * from tenant_journals')).rejects.toThrow('permission denied');await expect(db.query("select tenant_finance_ensure($1)",[cid])).rejects.toThrow('permission denied');});
});
it('classifies opening stock and uninvoiced goods separately from count gains',async()=>{
 const business=(classification:string,delta:number,key=randomUUID())=>identity(db,actors.a,()=>value(db,"select tenant_business_command($1,$2,'stock',$3) v",[cid,key,{warehouse_id:wid,product_id:product,delta,classification,reason:'Verified stock classification test'}]));
 const income=await balance('4200'),equity=await balance('3000');await business('opening',1);expect(await balance('3000')).toBe(equity-6000);expect(await balance('4200')).toBe(income);
 const key=randomUUID();await business('received_unbilled',2,key);await business('received_unbilled',2,key);expect(await balance('2300')).toBe(-12000);expect(await balance('4200')).toBe(income);
 await expect(business('received_unbilled',-1)).rejects.toThrow('classification');await expect(business('made-up',1)).rejects.toThrow('classification');
});
it('collects customer credit centrally without a drawer or recognizing revenue again',async()=>{
 const credit=await pos('sale',input(0)),income=await balance('4000');
 const key=randomUUID(),data={sale_id:credit.id,amount_kobo:10000,payment_account:'1010',reference:'CENTRAL-COLLECTION-001',confirmed:true};
 const collect=()=>identity(db,actors.a,()=>value(db,"select tenant_finance_command($1,$2,'collect',$3) v",[cid,key,data]));await collect();await collect();
 expect(await balance('1100')).toBe(0);expect(await balance('4000')).toBe(income);
 expect(await value(db,'select count(*)::int v from tenant_pos_tenders where company_id=$1 and command_id=$2 and session_id is null',[cid,key])).toBe(1);
});
it('records tax configuration history and blocks posting into a closed period without consuming stock',async()=>{
 await pos('tax',{tax_bps:750,label:'Configured tax'});await pos('tax',{tax_bps:0,label:'No configured tax'});
 expect(await value(db,'select count(*)::int v from tenant_pos_tax_versions where company_id=$1',[cid])).toBe(2);
 await db.query('update tenant_accounting_periods set closed_at=now(),closed_by=$2 where company_id=$1',[cid,actors.a]);
 const before=await value(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2',[cid,wid]);
 await expect(pos('sale',input())).rejects.toThrow('period is closed');
 expect(await value(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2',[cid,wid])).toBe(before);
});
