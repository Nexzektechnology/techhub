import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
it('posts verified online collections to clearing once, snapshots costs privately and keeps the buyer receipt safe',async()=>{
 const db=await tenantDatabase();try{
  const cid=await company(db,'a','online-ledger');const cmd=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
  const branch=(await cmd('branch',{name:'Lagos'})).id,warehouse=(await cmd('warehouse',{name:'Main',branch_id:branch})).id,category=(await cmd('category',{name:'Foods'})).id;
  const product=(await cmd('product',{name:'Rice',slug:'rice',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
  await db.query('update products set cost_kobo=6000 where id=$1',[product]);await cmd('stock',{warehouse_id:warehouse,product_id:product,delta:10,reason:'Verified stock count'});await cmd('storefront',{warehouse_id:warehouse,delivery_kobo:500,published:true});
  await db.query("insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values($1,'ACCT_onlineLedger','online-ledger',$2)",[cid,actors.root]);
  const order=await identity(db,actors.customer,()=>value<{id:string;reference:string;total_kobo:number}>(db,'select tenant_checkout($1,$2) v',['online-ledger',{key:randomUUID(),items:[{product_id:product,quantity:2,expected_price_kobo:10000,options:{}}],address:{name:'Customer name',email:'customer@tenant.example',phone:'08012345678',street:'123 Customer Street',city:'Lagos',state:'Lagos'},coupon:''}]));
  const confirm=()=>identity(db,'',()=>value(db,"select tenant_apply_payment($1,$2,'NGN','success','1234567') v",[order.reference,order.total_kobo]),'service_role');await confirm();await confirm();
  expect(await value(db,"select count(*)::int v from tenant_journals where company_id=$1 and source_kind='online-sale'",[cid])).toBe(1);
  expect(await value(db,"select sum(debit_kobo-credit_kobo)::text v from tenant_journal_lines where company_id=$1 and account_code='1030'",[cid])).toBe('20500');
  expect(await value(db,'select count(*)::int v from tenant_order_costs where company_id=$1 and unit_cost_kobo=6000',[cid])).toBe(1);
  const receipt=await identity(db,actors.customer,()=>value<{items:Record<string,unknown>[]}>(db,'select tenant_my_order($1,$2) v',['online-ledger',order.reference]));expect(receipt.items.every(i=>!('unit_cost_kobo'in i))).toBe(true);
  await expect(identity(db,actors.a,()=>db.query("select tenant_apply_payment($1,$2,'NGN','success','1234567')",[order.reference,order.total_kobo]))).rejects.toThrow('permission denied');
  const snapshot=await identity(db,actors.a,()=>value<{cash_flow:{code:string}[];trial_balance:{code:string;balance_kobo:string}[]}>(db,'select tenant_finance_snapshot($1) v',[cid]));expect(snapshot.cash_flow.some(c=>c.code==='1030')).toBe(false);expect(snapshot.trial_balance.find(a=>a.code==='1030')?.balance_kobo).toBe('20500');
 }finally{await db.close();}
});
