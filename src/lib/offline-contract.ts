import {z} from 'zod';
import {tenantCommand,type TenantCommerce} from './tenant-commerce';
export const offlineCommand=tenantCommand.refine(c=>['stock','product','order-status'].includes(c.action),'This change requires a connection').refine(c=>!['product','order-status'].includes(c.action)||('id'in c.data&&!!c.data.id),'A record ID is required');
export const offlineOperation=z.object({id:z.uuid(),command:offlineCommand,expected:z.string().max(40).nullable(),after:z.uuid().nullable(),cancel:z.boolean().optional()}).strict().refine(o=>o.after!==o.id&&(o.expected!==null||o.after!==null),'Invalid dependency');
export const offlineBatch=z.object({actor:z.uuid(),operations:z.array(offlineOperation).min(1).max(10)}).strict();
export type OfflineOperation=z.infer<typeof offlineOperation>;
export type SavedOperation=OfflineOperation&{created:number;status:'pending'|'review'|'applied'|'cancelled';error?:string;appliedAt?:number;version?:string};
export type OfflineData=Pick<TenantCommerce,'company_id'|'access'|'permissions'|'products'|'product_count'|'categories'|'warehouses'|'branches'|'inventory'>&{orders:Pick<TenantCommerce['orders'][number],'id'|'reference'|'status'|'payment_status'|'warehouse_id'|'total_kobo'>[]};
export type OfflineSnapshot={actor:string;slug:string;name:string;savedAt:string;downloadStarted?:number;data:OfflineData;versions:Record<string,string>;counts:{products:number;inventory:number;orders:number};partial?:boolean};
export function syncTarget(action:string,data:Record<string,unknown>){return JSON.stringify([action,action==='stock'?null:data.id??null,action==='stock'?data.warehouse_id??null:null,action==='stock'?data.product_id??null:null]);}
export function normalizeVersions(input:Record<string,string>){return Object.fromEntries(Object.entries(input).map(([k,v])=>[JSON.stringify(JSON.parse(k)),v]));}
function afterSnapshot(row:SavedOperation,snapshot:OfflineSnapshot){return row.status==='pending'||row.status==='applied'&&(row.appliedAt||0)>=(snapshot.downloadStarted||0);}
export function projectedProducts(snapshot:OfflineSnapshot,rows:SavedOperation[]){return snapshot.data.products.map(original=>{let p=original;for(const row of rows)if(afterSnapshot(row,snapshot)&&row.command.action==='product'&&row.command.data.id===p.id)p={...p,...row.command.data,id:p.id,tenant_slug:row.command.data.slug};return p;});}
export function projectedOrders(snapshot:OfflineSnapshot,rows:SavedOperation[]){return snapshot.data.orders.map(original=>{let order=original;for(const row of rows)if(afterSnapshot(row,snapshot)&&row.command.action==='order-status'&&row.command.data.id===order.id)order={...order,status:row.command.data.status};return order;});}
