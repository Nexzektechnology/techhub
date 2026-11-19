import {z} from 'zod';
import type {Product,Order,Category} from './types';
import type {Theme} from './theme';
export const tenantPermissions=['catalogue.read','catalogue.edit','inventory.read','inventory.adjust','orders.read','orders.manage','finance.read','finance.manage','procurement.manage','reports.read','locations.manage','team.manage','storefront.manage','affiliates.read','affiliates.manage','affiliates.approve'] as const;
const id=z.string().min(1).max(100),name=z.string().trim().min(2).max(100),location={id:id.optional(),name,address:z.string().max(500).default('')};
export const tenantCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('branch'),data:z.object({...location,id:z.uuid().optional()}).strict()}),
 z.object({action:z.literal('warehouse'),data:z.object({...location,branch_id:z.uuid()}).strict()}),
 z.object({action:z.literal('category'),data:z.object({id:id.optional(),name,parent_id:id.optional()}).strict()}),
 z.object({action:z.literal('product'),data:z.object({id:id.optional(),name:z.string().trim().min(2).max(200),slug:z.string().max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),category_id:id,brand:z.string().max(100).default(''),price_kobo:z.number().int().min(1).max(1000000000),image:z.string().max(1000).refine(v=>/^https:\/\//.test(v)||/^\/(?!\/)/.test(v),'Use an HTTPS or local image URL'),description:z.string().max(10000).default(''),options:z.record(z.string().min(1).max(60),z.array(z.string().min(1).max(80)).min(1).max(50)).default({}),active:z.boolean()}).strict()}),
 z.object({action:z.literal('stock'),data:z.object({warehouse_id:id,product_id:id,delta:z.number().int().min(-1000000).max(1000000).refine(n=>n!==0),reason:z.string().trim().min(5).max(500)}).strict()}),
 z.object({action:z.literal('role'),data:z.object({id:z.uuid().optional(),name,permissions:z.array(z.enum(tenantPermissions)).min(1).max(30),active:z.boolean()}).strict()}),
 z.object({action:z.literal('binding'),data:z.object({id:z.uuid().optional(),user_id:z.uuid(),role_id:z.uuid(),scope:z.enum(['company','branch','warehouse']),branch_id:z.uuid().optional(),warehouse_id:id.optional(),active:z.boolean().default(true)}).strict()}),
 z.object({action:z.literal('storefront'),data:z.object({warehouse_id:id,delivery_kobo:z.number().int().min(0).max(100000000),published:z.boolean()}).strict()}),
 z.object({action:z.literal('order-status'),data:z.object({id:z.uuid(),status:z.enum(['ready_for_dispatch','delivered'])}).strict()}),
]);
export type TenantCommerce={company_id:string;access:string;permissions:string[];branches:{id:string;name:string;address:string}[];warehouses:{id:string;name:string;branch_id:string;address:string}[];categories:Category[];products:(Product&{tenant_slug:string;available_stock:number})[];product_count:number;inventory:{warehouse_id:string;product_id:string;on_hand:number;reserved:number}[];orders:(Order&{warehouse_id:string})[];roles:{id:string;name:string;permissions:string[];active:boolean}[];bindings:{id:string;user_id:string;role_id:string;scope:string;branch_id:string|null;warehouse_id:string|null;active:boolean}[];members:{user_id:string;label:string;role:string}[];storefront:{warehouse_id:string;delivery_kobo:number;published:boolean}|null};
export type TenantStorefront={company:{id:string;name:string;slug:string;brand:Theme};products:Product[];count:number;delivery_kobo:number;checkout_ready:boolean};
