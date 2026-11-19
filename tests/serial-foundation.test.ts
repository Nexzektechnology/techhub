import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {tenantDatabase,actors,identity,value,company} from './helpers/tenant-db';
let db:PGlite,cid:string,wid:string,product:string,first:string,second:string;
const commerce=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[cid,action,data]));
beforeAll(async()=>{
 db=await tenantDatabase();cid=await company(db,'a','serial-foundation');const branch=(await commerce('branch',{name:'Lagos'})).id;wid=(await commerce('warehouse',{name:'Serialized warehouse',branch_id:branch})).id;const category=(await commerce('category',{name:'Devices'})).id;product=(await commerce('product',{name:'Device',slug:'device',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;
 await commerce('stock',{warehouse_id:wid,product_id:product,delta:2,reason:'Verified stock before serial commissioning'});
});
afterAll(async()=>db?.close());
it('refuses activation until identified units reconcile to warehouse stock',async()=>{
 await expect(db.query("insert into tenant_tracking_products(company_id,product_id,mode) values($1,$2,'serial')",[cid,product])).rejects.toThrow('Serial unit totals');
 first=await value(db,"insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,imei,source_reference) values($1,$2,$3,'DEVICE-A','123456789012345','VERIFIED-OPENING') returning id v",[cid,product,wid]);
 second=await value(db,"insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,source_reference) values($1,$2,$3,'DEVICE-B','VERIFIED-OPENING') returning id v",[cid,product,wid]);
 await db.query("insert into tenant_tracking_products(company_id,product_id,mode) values($1,$2,'serial')",[cid,product]);
 await expect(db.query("insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,source_reference) values($1,$2,$3,'device-a','DUPLICATE-SERIAL')",[cid,product,wid])).rejects.toThrow('tenant_serial_identity');
});
it('blocks forgotten stock-writing paths and rolls back both units and derived counters',async()=>{
 await expect(commerce('stock',{warehouse_id:wid,product_id:product,delta:1,reason:'Attempting an unidentified stock increase'})).rejects.toThrow('Serial unit totals');
 await expect(db.query("update tenant_serial_units set state='quarantine' where company_id=$1 and id=$2",[cid,first])).rejects.toThrow('Serial unit totals');
 expect(await value(db,'select physical v from tenant_serial_totals where company_id=$1',[cid])).toBe(2);expect(await value(db,'select on_hand v from tenant_inventory where company_id=$1',[cid])).toBe(2);
});
it('allows atomic reservation and trusted consumption while maintaining the independent stock invariant',async()=>{
 await db.transaction(async tx=>{await tx.query("update tenant_serial_units set state='reserved' where company_id=$1 and id=$2",[cid,first]);await tx.query('update tenant_inventory set reserved=1 where company_id=$1',[cid]);});
 await expect(db.query('update tenant_inventory set reserved=0 where company_id=$1',[cid])).rejects.toThrow('Serial unit totals');
 await db.transaction(async tx=>{await tx.query("update tenant_serial_units set state='sold' where company_id=$1 and id=$2",[cid,first]);await tx.query('update tenant_inventory set reserved=0,on_hand=1 where company_id=$1',[cid]);});
 expect(await value(db,'select physical v from tenant_serial_totals where company_id=$1',[cid])).toBe(1);
});
it('preserves identities and immutable provenance and denies direct browser access to the private registry',async()=>{
 await expect(db.query("update tenant_serial_units set serial='REPLACEMENT' where company_id=$1 and id=$2",[cid,second])).rejects.toThrow('identity is immutable');
 await db.query("select tenant_serial_event($1,$2,'reserved',$3,'test.consumed','SOURCE-001','Verified source transition')",[cid,first,wid]);
 await expect(db.query('delete from tenant_serial_events where company_id=$1',[cid])).rejects.toThrow('immutable');
 await identity(db,actors.a,async()=>{await expect(db.query('select * from tenant_serial_units')).rejects.toThrow('permission denied');await expect(db.query('update tenant_serial_totals set physical=99')).rejects.toThrow('permission denied');await expect(db.query('select tenant_serial_select($1,$2,$3,1)',[cid,product,wid])).rejects.toThrow('permission denied');});
});
it('selects exact distinct in-scope units and records trusted atomic source transitions',async()=>{
 expect(await value(db,'select tenant_serial_select($1,$2,$3,1) v',[cid,product,wid])).toEqual([second]);
 await expect(db.query("select tenant_serial_select($1,$2,$3,2,null,$4)",[cid,product,wid,[second,second]])).rejects.toThrow('distinct');
 await expect(db.query("select tenant_serial_select($1,$2,$3,1,null,$4)",[cid,product,wid,[first]])).rejects.toThrow('unavailable');
 await db.transaction(async tx=>{await tx.query("select tenant_serial_transition($1,$2,'available','quarantine','test.quarantine','SOURCE-002','Verified physical inspection')",[cid,[second]]);await tx.query('update tenant_inventory set on_hand=0 where company_id=$1',[cid]);});
 expect(await value(db,'select physical v from tenant_serial_totals where company_id=$1',[cid])).toBe(0);expect(await value(db,"select count(*)::int v from tenant_serial_events where company_id=$1 and source_id='SOURCE-002'",[cid])).toBe(1);
});
