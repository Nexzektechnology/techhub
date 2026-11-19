import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,cid:string,wid:string,destination:string,product:string,affiliate:string,rid:string;const units:string[]=[];
const cmd=(action:string,data:unknown,key=randomUUID(),who=actors.a)=>identity(db,who,()=>value<{id:string}>(db,'select tenant_affiliate_command($1,$2,$3,$4) v',[cid,key,action,data]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date());
const ledger=(code:string,warehouse:string|null=null)=>value(db,'select coalesce(sum(l.debit_kobo-l.credit_kobo),0)::text v from tenant_journal_lines l join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id where l.company_id=$1 and l.account_code=$2 and($3::text is null or j.warehouse_id=$3)',[cid,code,warehouse]).then(Number);
const request=async(ids:string[],relationship='consignment')=>(await cmd('request',{affiliate_id:affiliate,warehouse_id:wid,product_id:product,quantity:ids.length,unit_ids:ids,relationship,settlement_kobo:['temporary','interbranch'].includes(relationship)?0:10000,expected_price_kobo:12000,commission_bps:relationship==='consignment'?1000:0,collection_date:today(),settlement_deadline:today(),return_deadline:today(),terms:'Identified units reviewed before physical release',...(relationship==='interbranch'?{destination_warehouse:destination}:{})})).id;
const approve=(id:string)=>cmd('approve',{release_id:id,note:'Independent manager reviewed each identified unit and agreed terms'},randomUUID(),actors.staff);
const stock=()=>value<number>(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2',[cid,wid]);
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','custody-serials');const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
 const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Source',branch_id:branch})).id;destination=(await commerce('warehouse',{name:'Destination',branch_id:branch})).id;const category=(await commerce('category',{name:'Devices'})).id;product=(await commerce('product',{name:'Phone',slug:'phone',category_id:category,price_kobo:12000,image:'/window.svg',active:true,options:{}})).id;
 await db.query('update products set cost_kobo=6000 where id=$1',[product]);await commerce('stock',{warehouse_id:wid,product_id:product,delta:4,classification:'opening',reason:'Verified opening stock before commissioning'});
 for(const serial of ['A','B','C','D'])units.push(await value(db,'insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,source_reference) values($1,$2,$3,$4,$5) returning id v',[cid,product,wid,'PHONE-'+serial,'VERIFIED-OPENING']));await db.query("insert into tenant_tracking_products(company_id,product_id,mode,warranty_days) values($1,$2,'serial',365)",[cid,product]);
 affiliate=(await cmd('register',{name:'Identified stock partner',email:'customer@tenant.example'})).id;
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[cid]));const role=(await commerce('role',{name:'Independent approver',permissions:['affiliates.read','affiliates.approve']})).id;await commerce('binding',{user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:wid});
});
afterAll(async()=>db?.close());
it('requires the exact unit set reviewed by the independent approver and releases it once without revenue',async()=>{
 rid=await request(units.slice(0,3));expect(await stock()).toBe(4);await approve(rid);
 await expect(cmd('release',{release_id:rid,unit_ids:[units[0],units[1],units[3]],confirmed:true,reference:'WRONG-IDENTIFIED-HANDOVER'})).rejects.toThrow('approving manager');
 const key=randomUUID(),data={release_id:rid,confirmed:true,reference:'IDENTIFIED-HANDOVER-001'};await cmd('release',data,key);await cmd('release',data,key);expect(await stock()).toBe(1);expect(await ledger('1200')).toBe(6000);expect(await ledger('1230')).toBe(18000);expect(await ledger('4000')).toBe(0);
 const snapshot=await identity(db,actors.customer,()=>value<{releases:{units:{id:string;serial:string}[];unit_cost_kobo:null}[]}>(db,'select tenant_affiliate_snapshot($1,null,$2) v',[cid,rid]));expect(snapshot.releases[0].units).toHaveLength(3);expect(snapshot.releases[0].unit_cost_kobo).toBeNull();expect(JSON.stringify(snapshot.releases[0].units)).not.toContain('acquisition_cost');
 await cmd('acknowledge',{release_id:rid,confirmed:true,note:'I counted and received the three listed identified phones'},randomUUID(),actors.customer);
});
it('rejects overlapping or substituted declarations and physically inspects the same identified returned units',async()=>{
 const saleDeclaration=randomUUID();await cmd('sale-declare',{release_id:rid,quantity:1,unit_ids:[units[0]],note:'Phone A sold with the original customer evidence'},saleDeclaration,actors.customer);
 await expect(cmd('return-declare',{release_id:rid,quantity:1,unit_ids:[units[0]],note:'Attempt to declare a unit already in another pending report'},randomUUID(),actors.customer)).rejects.toThrow('pending declaration');
 await expect(cmd('sale',{release_id:rid,declaration_id:saleDeclaration,quantity:1,unit_ids:[units[1]],verified:true,note:'Wrong unit substituted for the declared customer sale'})).rejects.toThrow('selected declaration');
 await cmd('sale',{release_id:rid,declaration_id:saleDeclaration,quantity:1,unit_ids:[units[0]],verified:true,note:'Completed sale verified against the declared serial'});expect(await ledger('1230')).toBe(12000);
 const returnDeclaration=randomUUID();await cmd('return-declare',{release_id:rid,quantity:2,unit_ids:units.slice(1,3),note:'Two unsold identified units returned for staff inspection'},returnDeclaration,actors.customer);expect(await stock()).toBe(1);
 await cmd('inspect',{release_id:rid,declaration_id:returnDeclaration,quantity:1,unit_ids:[units[1]],disposition:'resellable',verified:true,note:'Phone B physically verified and accepted as resellable'});expect(await stock()).toBe(2);
 await cmd('inspect',{release_id:rid,declaration_id:returnDeclaration,quantity:1,unit_ids:[units[2]],disposition:'damaged',verified:true,note:'Phone C physically inspected and recorded as damaged'});expect(await stock()).toBe(2);expect(await ledger('1230')).toBe(0);expect(await ledger('5100')).toBe(6000);
 expect(await value(db,'select condition v from tenant_serial_units where company_id=$1 and id=$2',[cid,units[1]])).toBe('used');
});
it('receives identified transit stock at its authorized destination and keeps returns separate from destination receipts',async()=>{
 const transfer=await request([units[3]],'interbranch');await approve(transfer);await cmd('release',{release_id:transfer,confirmed:true,reference:'IDENTIFIED-TRANSFER-001'});expect(await ledger('1220')).toBe(6000);
 await cmd('receive',{release_id:transfer,quantity:1,unit_ids:[units[3]],verified:true,note:'Destination staff counted and scanned Phone D'});
 expect(await value(db,'select warehouse_id v from tenant_serial_units where company_id=$1 and id=$2',[cid,units[3]])).toBe(destination);expect(await ledger('1220')).toBe(0);expect(await ledger('1290')).toBe(0);expect(await ledger('1200',wid)).toBe(6000);expect(await ledger('1200',destination)).toBe(6000);
 const summary=await identity(db,actors.a,()=>value<{summary:{returned:number;received:number}}>(db,'select tenant_affiliate_snapshot($1) v',[cid]));expect(summary.summary).toMatchObject({returned:1,received:1});
});
it('lets an independent manager reject a request without moving its identified stock',async()=>{
 const rejected=await request([units[1]],'temporary');const before=await stock();await cmd('reject-request',{release_id:rejected,note:'Manager rejected this temporary handover after reviewing its purpose'},randomUUID(),actors.staff);expect(await stock()).toBe(before);
 expect(await value(db,'select status v from tenant_custody_releases where company_id=$1 and id=$2',[cid,rejected])).toBe('rejected');
 await expect(db.query('delete from tenant_serial_requested_links where company_id=$1',[cid])).rejects.toThrow('immutable');
});
