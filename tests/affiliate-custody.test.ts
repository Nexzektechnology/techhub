import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,cid:string,wid:string,destination:string,product:string,affiliate:string,release:string;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date());
const command=(action:string,data:unknown,key=randomUUID(),who=actors.a)=>identity(db,who,()=>value<Record<string,unknown>>(db,'select tenant_affiliate_command($1,$2,$3,$4) v',[cid,key,action,data]));
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
const ledger=(code:string)=>value(db,'select coalesce(sum(debit_kobo-credit_kobo),0)::text v from tenant_journal_lines where company_id=$1 and account_code=$2',[cid,code]).then(Number);
const stock=()=>value<number>(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2 and product_id=$3',[cid,wid,product]);
const snapshot=(who=actors.a,rid:string|null=release)=>identity(db,who,()=>value<{releases:Record<string,unknown>[];summary:Record<string,unknown>;events:Record<string,unknown>[]}>(db,'select tenant_affiliate_snapshot($1,null,$2) v',[cid,rid]));
const request=async(relationship='consignment',qty=5,settlement=10000)=>String((await command('request',{affiliate_id:affiliate,warehouse_id:wid,product_id:product,relationship,quantity:qty,settlement_kobo:['temporary','interbranch'].includes(relationship)?0:settlement,expected_price_kobo:12000,commission_bps:relationship==='consignment'?1000:0,collection_date:today(),settlement_deadline:today(),return_deadline:today(),terms:'Agreed stock and settlement terms',...(relationship==='interbranch'?{destination_warehouse:destination}:{})})).id);
const handover=async(rid:string)=>{await command('approve',{release_id:rid,note:'Independent manager verified all agreed terms'},randomUUID(),actors.staff);await command('release',{release_id:rid,confirmed:true,reference:'HANDOVER-'+rid});await command('acknowledge',{release_id:rid,confirmed:true,note:'Recipient counted and accepted the listed goods'},randomUUID(),actors.customer);};
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','custody-a');const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Source warehouse',branch_id:branch})).id;destination=(await commerce('warehouse',{name:'Destination',branch_id:branch})).id;
 const category=(await commerce('category',{name:'Phones'})).id;product=(await commerce('product',{name:'Phone',slug:'phone',category_id:category,price_kobo:12000,image:'/window.svg',active:true,options:{}})).id;
 await db.query('update products set cost_kobo=6000 where id=$1',[product]);await commerce('stock',{warehouse_id:wid,product_id:product,delta:30,classification:'opening',reason:'Verified opening stock'});
 affiliate=String((await command('register',{name:'Partner One',email:'customer@tenant.example'})).id);
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[cid]));const role=(await commerce('role',{name:'Custody approving manager',permissions:['affiliates.read','affiliates.approve']})).id;await commerce('binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:wid});
});
afterAll(async()=>db?.close());
it('requires independent approval and releases available stock once without consignment revenue or cash',async()=>{
 release=await request();await expect(command('approve',{release_id:release,note:'Attempting to approve my own request'})).rejects.toThrow('different approving manager');
 await expect(command('release',{release_id:release,confirmed:true,reference:'UNAPPROVED-001'})).rejects.toThrow('Approve');
 await command('approve',{release_id:release,note:'Independent review of custody and selling terms'},randomUUID(),actors.staff);
 const key=randomUUID(),payload={release_id:release,confirmed:true,reference:'HANDOVER-001'};await command('release',payload,key);await command('release',payload,key);
 expect(await stock()).toBe(25);expect(await ledger('4000')).toBe(0);expect(await ledger('1000')).toBe(0);expect(await ledger('1200')).toBe(150000);expect(await ledger('1230')).toBe(30000);
});
it('limits the recipient portal to its own releases without exposing recorded cost',async()=>{
 const context=await identity(db,actors.customer,()=>value<{id:string;slug:string}>(db,"select tenant_affiliate_context('custody-a') v"));expect(context).toMatchObject({id:cid,slug:'custody-a'});
 expect(await identity(db,actors.customer,()=>value<unknown[]>(db,'select my_affiliate_workspaces() v'))).toHaveLength(1);
 const own=await snapshot(actors.customer);expect(own.releases).toHaveLength(1);expect(own.releases[0].unit_cost_kobo).toBeNull();
 await expect(snapshot(actors.b)).rejects.toThrow('Forbidden');await expect(command('release',{release_id:release,confirmed:true,reference:'HOSTILE-001'},randomUUID(),actors.customer)).rejects.toThrow('Forbidden');
 await command('acknowledge',{release_id:release,confirmed:true,note:'I counted and received five sealed phones'},randomUUID(),actors.customer);
});

it('verifies partial sale declarations, creates receivable and earned commission, and remits without duplicate revenue',async()=>{
 const declaration=randomUUID();await command('sale-declare',{release_id:release,quantity:2,note:'Two units sold to verified customers'},declaration,actors.customer);
 expect(await ledger('4000')).toBe(0);await command('sale',{release_id:release,quantity:2,verified:true,declaration_id:declaration,note:'Manager checked actual completed sale evidence'});
 expect(await ledger('4000')).toBe(-20000);expect(await ledger('1110')).toBe(20000);expect(await ledger('2200')).toBe(-2000);expect(await ledger('1200')).toBe(150000);expect(await ledger('1230')).toBe(18000);expect(await stock()).toBe(25);
 const key=randomUUID(),payload={release_id:release,amount_kobo:12000,payment_account:'1010',reference:'REMIT-001',confirmed:true};await command('remit',payload,key);await command('remit',payload,key);
 expect(await ledger('1110')).toBe(8000);expect(await ledger('4000')).toBe(-20000);
 await expect(command('commission-pay',{...payload,amount_kobo:2000,reference:'COMMISSION-001'})).rejects.toThrow('Settle');await command('remit',{...payload,amount_kobo:8000,reference:'REMIT-002'});
 await command('commission-pay',{...payload,amount_kobo:2000,reference:'COMMISSION-002'});expect(await ledger('2200')).toBe(0);expect(await ledger('1010')).toBe(18000);
});
it('keeps declared returns in custody until inspection, restores only resellable goods, and records damaged loss',async()=>{
 const declaration=randomUUID();await command('return-declare',{release_id:release,quantity:3,note:'Three remaining units sent back for inspection'},declaration,actors.customer);
 expect(await stock()).toBe(25);expect((await snapshot()).releases[0].custody).toBe(3);
 await command('inspect',{release_id:release,declaration_id:declaration,quantity:2,disposition:'resellable',verified:true,note:'Two sealed units inspected and accepted'});expect(await stock()).toBe(27);
 await command('inspect',{release_id:release,declaration_id:declaration,quantity:1,disposition:'damaged',verified:true,note:'One cracked unit physically inspected and quarantined'});expect(await stock()).toBe(27);expect(await ledger('5100')).toBe(6000);expect((await snapshot()).releases[0]).toMatchObject({status:'closed',returned:2,damaged:1,custody:0});
 await expect(command('inspect',{release_id:release,declaration_id:declaration,quantity:1,disposition:'resellable',verified:true,note:'Repeated inspection of the same goods'})).rejects.toThrow('quantity');
});
it('recognizes wholesale credit at release only and handles a paid-before-return credit refund',async()=>{
 const rid=await request('wholesale_credit',2);await handover(rid);const revenue=await ledger('4000');await command('sale',{release_id:rid,quantity:1,verified:true,note:'One wholesale unit sold by recipient'});expect(await ledger('4000')).toBe(revenue);
 await command('remit',{release_id:rid,amount_kobo:20000,payment_account:'1010',reference:'WHOLESALE-REMIT-001',confirmed:true});
 const declaration=randomUUID();await command('return-declare',{release_id:rid,quantity:1,note:'Unsold unit returned under agreed wholesale terms'},declaration,actors.customer);await command('inspect',{release_id:rid,declaration_id:declaration,quantity:1,disposition:'resellable',verified:true,note:'Wholesale return inspected and accepted'});
 expect((await snapshot(actors.a,rid)).releases[0].balance_kobo).toBe('-10000');await command('refund',{release_id:rid,amount_kobo:10000,payment_account:'1010',reference:'WHOLESALE-REFUND-001',confirmed:true});expect((await snapshot(actors.a,rid)).releases[0].status).toBe('closed');
});
it('receives interbranch stock at its verified destination without cash or new revenue',async()=>{
 const revenue=await ledger('4000'),cash=await ledger('1010'),rid=await request('interbranch',2);await handover(rid);await command('receive',{release_id:rid,quantity:2,verified:true,note:'Destination warehouse counted and accepted the goods'});expect(await ledger('4000')).toBe(revenue);expect(await ledger('1010')).toBe(cash);expect(await value(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2 and product_id=$3',[cid,destination,product])).toBe(2);
 await expect(db.query('delete from tenant_custody_events where company_id=$1',[cid])).rejects.toThrow('immutable');
});

it('rejects an incorrect declaration with an immutable reason without consuming goods or recognizing money',async()=>{
 const rid=await request('temporary',1);await handover(rid);const declaration=randomUUID();await command('return-declare',{release_id:rid,quantity:1,note:'Recipient accidentally reported an unsent return'},declaration,actors.customer);
 const before=await stock(),income=await ledger('4000');await command('declaration-reject',{release_id:rid,declaration_id:declaration,note:'Staff confirmed these goods remain with the recipient'});expect(await stock()).toBe(before);expect(await ledger('4000')).toBe(income);expect((await snapshot(actors.a,rid)).releases[0].custody).toBe(1);
 await expect(command('declaration-reject',{release_id:rid,declaration_id:declaration,note:'Attempting to reject an already resolved declaration'})).rejects.toThrow('unresolved');
});
it('preserves portal identity after requests while allowing audited contact updates',async()=>{
 await command('register',{id:affiliate,name:'Partner One',email:'customer@tenant.example',phone:'08012345678',active:true});
 await expect(command('register',{id:affiliate,name:'Another person',email:'b@tenant.example'})).rejects.toThrow('Portal identity is locked');
 expect(await identity(db,actors.customer,()=>value<unknown[]>(db,'select my_affiliate_workspaces() v'))).toHaveLength(1);
});
it('snapshots configured tax, allocates partial-sale rounding exactly and reverses wholesale return tax once',async()=>{
 const tax=(rate:number)=>identity(db,actors.a,()=>db.query("select tenant_pos_command($1,$2,'tax',$3)",[cid,randomUUID(),{tax_bps:rate,label:'Configured sales tax'}]));await tax(750);
 const beforeTax=await ledger('2100'),beforeDebt=await ledger('1110'),rid=await request('consignment',3,10007);await handover(rid);
 await command('sale',{release_id:rid,quantity:1,verified:true,note:'Verified first customer sale with configured tax'});await command('sale',{release_id:rid,quantity:2,verified:true,note:'Verified remaining completed sales with configured tax'});
 expect(await ledger('2100')).toBe(beforeTax-2252);expect(await ledger('1110')).toBe(beforeDebt+32273);expect((await snapshot(actors.a,rid)).releases[0].tax_charged_kobo).toBe('2252');
 const wholesale=await request('wholesale_credit',2,10007);await handover(wholesale);const wholesaleTax=await ledger('2100');
 for(let i=0;i<2;i++){const declaration=randomUUID();await command('return-declare',{release_id:wholesale,quantity:1,note:'One unsold wholesale unit submitted for inspection'},declaration,actors.customer);await command('inspect',{release_id:wholesale,declaration_id:declaration,quantity:1,disposition:'resellable',verified:true,note:'Physical wholesale return verified against its source'});}
 expect(await ledger('2100')).toBe(wholesaleTax+1501);expect((await snapshot(actors.a,wholesale)).releases[0]).toMatchObject({balance_kobo:'0',tax_credited_kobo:'1501',status:'closed'});
 const stale=await request('consignment',1);await command('approve',{release_id:stale,note:'Independent manager reviewed the original configured tax'},randomUUID(),actors.staff);await tax(500);await expect(command('release',{release_id:stale,confirmed:true,reference:'STALE-TAX-HANDOVER'})).rejects.toThrow('Tax configuration changed');await tax(0);
});
