import {z} from 'zod';

const identifier=z.string().trim().min(1).max(100);
const kobo=z.number().int().min(0).max(1_000_000_000);
const contact={
 name:z.string().trim().min(2).max(200),
 email:z.union([z.email().max(254),z.literal('')]).default(''),
 phone:z.string().trim().max(40).default(''),
 address:z.string().trim().max(500).default(''),
 notes:z.string().max(2000).default(''),active:z.boolean().default(true),
};
export const businessCommand=z.discriminatedUnion('action',[
 z.object({key:z.uuid(),action:z.literal('customer'),data:z.object({...contact,id:z.uuid().optional()}).strict()}).strict(),
 z.object({key:z.uuid(),action:z.literal('supplier'),data:z.object({...contact,id:identifier.optional()}).strict()}).strict(),
 z.object({key:z.uuid(),action:z.literal('product-master'),data:z.object({id:identifier,sku:z.string().trim().min(1).max(80),barcode:z.string().trim().max(100).default(''),cost_kobo:kobo,wholesale_kobo:kobo.min(1).nullable(),minimum_price_kobo:kobo,reorder_level:z.number().int().min(0).max(1_000_000),supplier_id:identifier.nullable()}).strict()}).strict(),
 z.object({key:z.uuid(),action:z.literal('stock'),data:z.object({warehouse_id:identifier,product_id:identifier,classification:z.enum(['count','opening','received_unbilled']).default('count'),delta:z.number().int().min(-1_000_000).max(1_000_000).refine(n=>n!==0),reason:z.string().trim().min(5).max(500)}).strict()}).strict(),
]);
export const businessFilters=z.object({branch:z.preprocess(value=>value===''?undefined:value,z.uuid().optional()),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),section:z.enum(['overview','customers','suppliers','products','inventory','activity']).default('overview')});
export type BusinessCommand=z.infer<typeof businessCommand>;
export type BusinessContact={id:string;name:string;email:string;phone:string;address:string;notes:string;active:boolean};
export type BusinessProduct={id:string;name:string;sku:string|null;barcode:string|null;cost_kobo:number;wholesale_kobo:number|null;minimum_price_kobo:number;reorder_level:number;supplier_id:string|null;price_kobo:number;active:boolean};
export type BusinessSnapshot={
 company_id:string;access:string;page:number;permissions:string[];
 can_manage_customers:boolean;can_manage_suppliers:boolean;can_manage_master:boolean;
 branches:{id:string;name:string}[];warehouses:{id:string;name:string;branch_id:string}[];
 customers:BusinessContact[];suppliers:BusinessContact[];products:BusinessProduct[];
 supplier_choices:{id:string;name:string}[];
 customer_count:number;supplier_count:number;product_count:number;inventory_count:number;movement_count:number;
 inventory:{warehouse_id:string;product_id:string;name:string;sku:string|null;on_hand:number;reserved:number;available:number;reorder_level:number}[];
 attention:BusinessSnapshot['inventory'];
 movements:{id:string;product_id:string;name:string;warehouse_id:string;quantity:number;movement_kind:'physical'|'reservation_release';reason:string;actor:string|null;command_id:string|null;created_at:string}[];
 metrics:{on_hand:number;reserved:number;available:number;low_stock:number};
};

// Use the same payload and key on a retry. A changed form is a new command.
export function pendingBusinessCommand(previous:BusinessCommand|null,next:{action:BusinessCommand['action'];data:unknown}):BusinessCommand{
 const candidate=businessCommand.parse({...next,key:previous?.key||crypto.randomUUID()});
 if(previous&&previous.action===candidate.action&&JSON.stringify(previous.data)===JSON.stringify(candidate.data))return previous;
 return previous?businessCommand.parse({...next,key:crypto.randomUUID()}):candidate;
}
