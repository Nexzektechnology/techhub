import {z} from 'zod';
import {defaultTheme,type Theme} from './theme';
import {reservedSubdomains} from './saas-domain-routing';

export const onboardInput=z.object({
 key:z.uuid(),name:z.string().trim().min(2).max(100),
 slug:z.string().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).refine(s=>!reservedSubdomains.has(s),'Choose a business URL name other than this reserved name'),plan_id:z.string().min(2).max(40),
 registration_number:z.string().trim().max(100),category:z.string().trim().min(2).max(100),
 address:z.string().trim().max(500),email:z.email(),phone:z.string().trim().max(40),
 primary:z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
export function companyTheme(name:string,primary:string,email:string,phone:string):Theme{
 return {...defaultTheme,name:name.slice(0,60),primary,email,phone,logo:'',lightLogo:'',darkLogo:'',mobileLogo:'',favicon:'',
 tagline:'Your company workspace',description:'',seoTitle:name,seoDescription:'',copyright:`© ${new Date().getFullYear()} ${name}`,
 navigation:[],footerLinks:[],announcement:'',announcementEnabled:false,heroTitle:name,heroText:'',heroImage:'',heroMobileImage:''};
}
export const companyCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('cancel'),company_id:z.uuid(),cancel:z.boolean()}).strict(),
 z.object({action:z.literal('disable-autopay'),company_id:z.uuid()}).strict(),
 z.object({action:z.literal('enroll-company'),company_id:z.uuid(),plan_id:z.string().min(2).max(40)}).strict(),
 z.object({action:z.literal('domain'),company_id:z.uuid(),host:z.string().trim().toLowerCase().max(253).regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)}).strict(),
 z.object({action:z.literal('domain-action'),company_id:z.uuid(),host:z.string().max(253),operation:z.enum(['remove','suspend','primary','challenge'])}).strict(),
 z.object({action:z.literal('activate-domain'),host:z.string().max(253),ready:z.boolean()}).strict(),
 z.object({action:z.literal('plan'),id:z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),name:z.string().trim().min(2).max(80),description:z.string().max(1000),
 available:z.boolean(),trial_days:z.number().int().min(0).max(90),grace_days:z.number().int().min(0).max(30),employee_limit:z.number().int().min(1).max(100000),storage_bytes:z.number().int().min(0).max(10995116277760),modules:z.array(z.enum(['branding','field_operations','commerce'])).max(3)}).strict(),
 z.object({action:z.literal('price'),plan_id:z.string().min(2).max(40),months:z.union([z.literal(1),z.literal(3),z.literal(6),z.literal(12)]),amount_kobo:z.number().int().min(100).max(100000000000)}).strict(),
]);
export const billingCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('checkout'),company_id:z.uuid(),price_id:z.uuid(),automatic:z.boolean().optional(),consent_version:z.literal('2026-11-16').optional()}).strict().refine(v=>!v.automatic||v.consent_version==='2026-11-16','Confirm automatic billing terms'),
 z.object({action:z.literal('verify'),reference:z.string().regex(/^edge-saas-[0-9a-f-]{36}$/)}).strict(),
 z.object({action:z.literal('resume'),reference:z.string().regex(/^edge-saas-[0-9a-f-]{36}$/)}).strict(),
]);
export type SaasPlan={id:string;name:string;description:string;available:boolean;trial_days:number;grace_days:number;employee_limit:number;storage_bytes:number};
export type SaasPrice={id:string;plan_id:string;months:number;amount_kobo:number;currency:string;available:boolean};
export type SaasDomain={host:string;company_id:string;challenge:string;challenge_expires_at:string;verified_until:string|null;state:string;tls_ready:boolean;is_primary:boolean};
export type SaasInvoice={id:string;reference:string;company_id:string;plan_id:string;months:number;amount_kobo:number;currency:string;status:string;paid_at:string|null;period_end:string|null};
export type SaasAsset={id:string;path:string;mime:string;size_bytes:number;created_at:string};
export type SaasPortal={company:{id:string;name:string;slug:string;active:boolean;brand:Theme};access:string;subscription:{state:string;plan_id:string|null;period_end:string|null;cancel_at_period_end:boolean};plan:SaasPlan|null;invoices:SaasInvoice[];domains:SaasDomain[];assets:SaasAsset[];usage:{employees:number;storage_bytes:number}};
export type SaasOverview={total:number;active:number;trialing:number;suspended:number;users:number;mrr_kobo:number;companies:{id:string;slug:string;name:string;active:boolean}[];plans:SaasPlan[];plan_modules:{plan_id:string;module:string}[];prices:SaasPrice[];domains:SaasDomain[]};
export const money=(kobo:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(kobo/100);
export const cycleName=(months:number)=>({1:'Monthly',3:'Quarterly',6:'Half-yearly',12:'Annually'}[months]||`${months} months`);
