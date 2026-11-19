import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,a:string,b:string,wid:string,otherWid:string,supplier:string,bill:string,expenseJournal:string;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date());
const cmd=(action:string,data:unknown,key=randomUUID(),who=actors.a,cid=a)=>identity(db,who,()=>value<Record<string,unknown>>(db,'select tenant_finance_command($1,$2,$3,$4) v',[cid,key,action,data]));
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[a,action,data]));
const balance=(code:string)=>value(db,'select coalesce(sum(debit_kobo-credit_kobo),0)::text v from tenant_journal_lines where company_id=$1 and account_code=$2',[a,code]).then(Number);
beforeAll(async()=>{
 db=await tenantDatabase();a=await company(db,'a','finance-a');b=await company(db,'b','finance-b');
 const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Main',branch_id:branch})).id;const other=(await commerce('branch',{name:'Abuja'})).id;otherWid=(await commerce('warehouse',{name:'Other',branch_id:other})).id;
 supplier=await identity(db,actors.a,()=>value<string>(db,"select tenant_business_command($1,$2,'supplier',$3)->>'id' v",[a,randomUUID(),{name:'Service supplier'}]));
 await cmd('setup',{});
});
afterAll(async()=>db?.close());
it('posts balanced manual opening funds without permitting control-account shortcuts',async()=>{
 await cmd('manual',{date:today(),description:'Verified opening cash and bank balances',flow:'opening',lines:[{account:'1000',debit:100000,credit:0},{account:'1010',debit:100000,credit:0},{account:'3000',debit:0,credit:200000}]});
 expect(await balance('1000')).toBe(100000);expect(await balance('1010')).toBe(100000);
 await expect(cmd('manual',{description:'Unlinked receivables manipulation',lines:[{account:'1100',debit:100,credit:0},{account:'4000',debit:0,credit:100}]})).rejects.toThrow('source workflow');
});
it('records received supplier bills and settles partial and full payable balances once',async()=>{
 bill=String((await cmd('bill',{warehouse_id:wid,supplier_id:supplier,date:today(),due_date:today(),reference:'SUPPLIER-INV-001',description:'Received repair and maintenance service',account_code:'6000',amount_kobo:30000})).id);
 expect(await balance('2000')).toBe(-30000);
 const key=randomUUID(),payload={bill_id:bill,date:today(),amount_kobo:10000,payment_account:'1010',reference:'BANK-PAY-001',confirmed:true};await cmd('pay',payload,key);await cmd('pay',payload,key);expect(await balance('2000')).toBe(-20000);
 await expect(cmd('pay',{...payload,amount_kobo:20001,reference:'BANK-PAY-002'})).rejects.toThrow('exceeds');
 await cmd('pay',{...payload,amount_kobo:20000,reference:'BANK-PAY-003'});expect(await balance('2000')).toBe(0);expect(await balance('1010')).toBe(70000);
});
it('records expenses, rejects duplicate bank references, and requires actual payment confirmation',async()=>{
 const payload={warehouse_id:wid,date:today(),description:'Office electricity payment',amount_kobo:5000,account_code:'6000',payment_account:'1010',reference:'BANK-EXPENSE-001',confirmed:true};
 expenseJournal=String((await cmd('expense',payload)).journal_id);expect(await balance('1010')).toBe(65000);
 await expect(cmd('expense',payload)).rejects.toThrow('reference already recorded');
 await expect(cmd('expense',{...payload,confirmed:false,reference:'BANK-EXPENSE-002'})).rejects.toThrow('actually moved');
});
it('imports statements idempotently and matches exact account, direction and amount to source events',async()=>{
 const row={external_id:'STATEMENT-ROW-001',date:today(),amount_kobo:-5000,reference:'BANK-EXPENSE-001',description:'Electricity transfer'};
 expect(await cmd('bank-import',{account_code:'1010',rows:[row]})).toMatchObject({inserted:1,duplicates:0});expect(await cmd('bank-import',{account_code:'1010',rows:[row]})).toMatchObject({inserted:0,duplicates:1});
 await expect(cmd('bank-import',{account_code:'1010',rows:[{...row,amount_kobo:-6000}]})).rejects.toThrow('changed data');
 const line=await value<string>(db,'select id v from tenant_bank_lines where company_id=$1',[a]),event=await value<string>(db,'select id v from tenant_cash_events where company_id=$1 and journal_id=$2',[a,expenseJournal]);
 await cmd('bank-match',{line_id:line,event_id:event,reason:'Bank statement and payment reference verified'});
 await expect(cmd('reverse',{journal_id:expenseJournal,date:today(),description:'Correction of the posted expense classification'})).rejects.toThrow('Unmatch');
 await cmd('bank-unmatch',{line_id:line,reason:'Preparing an approved expense classification correction'});
 expect(await value(db,'select count(*)::int v from tenant_bank_match_events where company_id=$1',[a])).toBe(2);
});
it('corrects expense errors with immutable reversal entries and permits a corrected source reference',async()=>{
 await cmd('reverse',{journal_id:expenseJournal,date:today(),description:'Correcting an erroneous expense classification'});expect(await balance('1010')).toBe(70000);
 await expect(cmd('reverse',{journal_id:expenseJournal,date:today(),description:'Attempting a repeated reversal of the same expense'})).rejects.toThrow('single_reversal');
 await cmd('expense',{warehouse_id:wid,date:today(),description:'Corrected electricity expense',amount_kobo:5000,account_code:'6000',payment_account:'1010',reference:'BANK-EXPENSE-001',confirmed:true});expect(await balance('1010')).toBe(65000);
 await expect(db.query('delete from tenant_expenses where company_id=$1',[a])).rejects.toThrow('immutable');
});
it('transfers between cash accounts without recognizing income or expense',async()=>{
 const before=await balance('6000');await cmd('transfer',{date:today(),description:'Deposit drawer cash into the bank',amount_kobo:10000,account_code:'1010',payment_account:'1000',reference:'CASH-DEPOSIT-001',confirmed:true});expect(await balance('1000')).toBe(90000);expect(await balance('1010')).toBe(75000);expect(await balance('6000')).toBe(before);
});
it('returns exact string amounts, source lines and warehouse-filtered reports without leaking other branches',async()=>{
 const snapshot=await identity(db,actors.a,()=>value<{trial_balance:{code:string;balance_kobo:string}[];journals:{warehouse_id:string|null;lines:unknown[]}[]}>(db,'select tenant_finance_snapshot($1,$2) v',[a,wid]));
 expect(snapshot.journals.every(j=>j.warehouse_id===wid)).toBe(true);expect(snapshot.journals.every(j=>j.lines.length>=2)).toBe(true);expect(snapshot.trial_balance.every(t=>typeof t.balance_kobo==='string')).toBe(true);
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));const role=(await commerce('role',{name:'Branch finance',permissions:['finance.read','finance.manage']})).id;await commerce('binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:wid});
 await expect(identity(db,actors.staff,()=>db.query('select tenant_finance_snapshot($1,$2)',[a,otherWid]))).rejects.toThrow('Forbidden');
 await expect(cmd('bank-import',{account_code:'1010',rows:[{external_id:'HOSTILE',date:today(),amount_kobo:1}]},randomUUID(),actors.staff)).rejects.toThrow('Forbidden');
 await expect(cmd('pay',{bill_id:bill,amount_kobo:1,payment_account:'1010',reference:'HOSTILE-REF',confirmed:true},randomUUID(),actors.b,b)).rejects.toThrow('unavailable');
});
it('exports authorized exact reports and calculates live supplier aging beyond the visible page',async()=>{
 const snapshot=await identity(db,actors.a,()=>value<{payable_aging:Record<string,string>;bill_count:number}>(db,'select tenant_finance_snapshot($1) v',[a]));
 expect(snapshot.bill_count).toBe(1);expect(snapshot.payable_aging).toEqual({});
 const rows=await identity(db,actors.a,()=>value<string[][]>(db,"select tenant_finance_export($1,'ledger') v",[a]));
 expect(rows[0]).toContain('Debit kobo');expect(rows.length).toBeGreaterThan(2);expect(rows.slice(1).every(r=>/^\d+$/.test(r[9])&&/^\d+$/.test(r[10]))).toBe(true);
 await expect(identity(db,actors.staff,()=>db.query("select tenant_finance_export($1,'ledger',$2)",[a,wid]))).rejects.toThrow('Forbidden');
 await cmd('bill',{warehouse_id:wid,supplier_id:supplier,date:today(),due_date:'2020-01-01',reference:'OVERDUE-BILL-001',description:'Verified historical unpaid service',account_code:'6000',amount_kobo:12345});
 const aged=await identity(db,actors.a,()=>value<{payable_aging:Record<string,string>}>(db,'select tenant_finance_snapshot($1) v',[a]));expect(aged.payable_aging.over_90).toBe('12345');
});
