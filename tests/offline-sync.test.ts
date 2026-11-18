import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {tenantDatabase,actors,company,identity,value} from './helpers/tenant-db';
import {normalizeVersions,syncTarget,offlineBatch} from '../src/lib/offline-contract';
let db:PGlite,a:string,b:string,w:string,p:string;
const command=(action:string,data:unknown)=>identity(db,actors.a,()=>value<{id:string}>(db,'select tenant_commerce_command($1,$2,$3) v',[a,action,data]));
const apply=(id:string,data:unknown,expected:string|null,after:string|null=null,cancel=false,actor=actors.a,cid=a)=>identity(db,actor,()=>value<{state:string;version:string}>(db,'select tenant_sync_apply($1,$2,$3,$4,$5,$6,$7) v',[cid,id,'stock',data,expected,after,cancel]));
const stock=()=>({warehouse_id:w,product_id:p,delta:5,reason:'Offline delivery received'});
async function snapshot(){return identity(db,actors.a,()=>value<{data:{company_id:string;products:unknown[]};versions:Record<string,string>}>(db,'select tenant_offline_snapshot($1) v',[a]));}
beforeAll(async()=>{db=await tenantDatabase();a=await company(db,'a','offline-a');b=await company(db,'b','offline-b');const branch=(await command('branch',{name:'Offline branch'})).id;w=(await command('warehouse',{name:'Offline warehouse',branch_id:branch})).id;const category=(await command('category',{name:'Offline goods'})).id;p=(await command('product',{name:'Saved product',slug:'saved-product',category_id:category,price_kobo:10000,image:'/window.svg',active:true,options:{}})).id;await command('stock',{...stock(),delta:20});});
afterAll(async()=>db?.close());
it('applies a lost-response retry exactly once and chains subsequent stock changes',async()=>{
 const s=await snapshot(),expected=normalizeVersions(s.versions)[syncTarget('stock',stock())],key=randomUUID();expect(expected).toBeTruthy();
 const first=await apply(key,stock(),expected);expect(first.state).toBe('applied');expect(await apply(key,stock(),expected)).toEqual(first);
 const second=await apply(randomUUID(),stock(),null,key);expect(second.state).toBe('applied');
 expect(await value<number>(db,'select on_hand v from tenant_inventory where company_id=$1 and warehouse_id=$2 and product_id=$3',[a,w,p])).toBe(30);
 await expect(apply(key,{...stock(),delta:10},expected)).rejects.toThrow('reused');
});
it('preserves online edits and rejects cross-company IDs and another actor dependencies',async()=>{
 const s=await snapshot(),version=normalizeVersions(s.versions)[syncTarget('stock',stock())];await command('stock',stock());
 await expect(apply(randomUUID(),stock(),version)).rejects.toThrow('Offline conflict');
 await expect(apply(randomUUID(),stock(),'absent',null,false,actors.b,a)).rejects.toThrow('Forbidden');
 await expect(apply(randomUUID(),stock(),'absent',null,false,actors.a,b)).rejects.toThrow('Forbidden');
 await expect(apply(randomUUID(),stock(),null,randomUUID())).rejects.toThrow('Earlier offline');
});
it('cancels uncertain requests atomically and returns an already committed result instead of cancelling it',async()=>{
 const s=await snapshot(),expected=normalizeVersions(s.versions)[syncTarget('stock',stock())],key=randomUUID();
 expect((await apply(key,stock(),expected,null,true)).state).toBe('cancelled');expect((await apply(key,stock(),expected)).state).toBe('cancelled');
 const committed=randomUUID();expect((await apply(committed,stock(),expected)).state).toBe('applied');expect((await apply(committed,stock(),expected,null,true)).state).toBe('applied');
});
it('protects the sync ledger, rejects setup/payment changes and restores forged caller context',async()=>{
 expect(offlineBatch.safeParse({actor:actors.a,operations:[{id:randomUUID(),command:{action:'storefront',data:{warehouse_id:w,delivery_kobo:0,published:true}},expected:'absent',after:null}]}).success).toBe(false);
 await identity(db,actors.a,async()=>{await db.query("select set_config('app.tenant_id',$1,false)",[b]);await db.query('select tenant_offline_snapshot($1)',[a]);expect(await value(db,"select current_setting('app.tenant_id') v")).toBe(b);await expect(db.query('select * from tenant_sync_receipts')).rejects.toThrow('permission denied');await db.query("select set_config('app.tenant_id','',false)");});
 await identity(db,actors.a,()=>db.query("select company_set_member($1,'staff@tenant.example','supervisor',true)",[a]));
 await expect(apply(randomUUID(),stock(),'absent',null,false,actors.staff)).rejects.toThrow('Forbidden');
 const role=(await command('role',{name:'Offline stock role',permissions:['inventory.read','inventory.adjust'],active:true})).id,binding=randomUUID();
 await command('binding',{id:binding,user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:w,active:true});
 const saved=await identity(db,actors.staff,()=>value<{versions:Record<string,string>}>(db,'select tenant_offline_snapshot($1) v',[a]));
 await command('binding',{id:binding,user_id:actors.staff,role_id:role,scope:'warehouse',warehouse_id:w,active:false});
 await expect(apply(randomUUID(),stock(),normalizeVersions(saved.versions)[syncTarget('stock',stock())],null,false,actors.staff)).rejects.toThrow('Forbidden');
});
it('synchronizes ordered fulfilment steps and never replays an earlier step over the delivered order',async()=>{
 const order=randomUUID();await db.query("insert into orders(id,company_id,customer_id,status,payment_status,address,subtotal_kobo,delivery_kobo,discount_kobo,total_kobo,reference,expires_at,warehouse_id,branch_id,settlement_subaccount) select $1,$2,$3,'processing','paid','{}',100,0,0,100,$4,now()+interval '30 minutes',id,branch_id,'ACCT_offlineFixture' from warehouses where id=$5",[order,a,actors.customer,'offline-order-'+order,w]);
 const saved=await snapshot(),data={id:order,status:'ready_for_dispatch'},expected=normalizeVersions(saved.versions)[syncTarget('order-status',data)],first=randomUUID();
 const run=(key:string,input:unknown,version:string|null,after:string|null)=>identity(db,actors.a,()=>value(db,'select tenant_sync_apply($1,$2,$3,$4,$5,$6) v',[a,key,'order-status',input,version,after]));
 expect(expected).toBeTruthy();await run(first,data,expected,null);await run(randomUUID(),{id:order,status:'delivered'},null,first);await run(first,data,expected,null);
 expect(await value(db,'select status v from orders where id=$1',[order])).toBe('delivered');
});
