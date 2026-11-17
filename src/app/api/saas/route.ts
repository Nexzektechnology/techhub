import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {onboardInput,companyCommand,companyTheme} from '@/lib/saas-contract';
import {boundedJson} from '@/lib/saas-server';
import {assertPublishable} from '@/lib/theme';
export async function POST(req:Request){try{
 guard(req);const {db}=await platformIdentity();const raw=await boundedJson(req);
 if(raw&&typeof raw==='object'&&'action' in raw){
  const c=companyCommand.parse(raw);let rpc:string;let args:Record<string,unknown>;
  switch(c.action){
   case 'cancel':rpc='saas_cancel';args={p_company:c.company_id,p_cancel:c.cancel};break;
   case 'disable-autopay':rpc='saas_disable_autopay';args={p_company:c.company_id};break;
   case 'enroll-company':rpc='saas_enroll_company';args={p_company:c.company_id,p_plan:c.plan_id};break;
   case 'domain':rpc='saas_request_domain';args={p_company:c.company_id,p_host:c.host};break;
   case 'domain-action':rpc='saas_domain_action';args={p_company:c.company_id,p_host:c.host,p_action:c.operation};break;
   case 'activate-domain':rpc='saas_activate_domain';args={p_host:c.host,p_ready:c.ready};break;
   case 'plan':{const {action:_,modules,...plan}=c;void _;rpc='saas_configure_plan';args={p_plan:plan,p_modules:modules};break;}
   case 'price':rpc='saas_publish_price';args={p_plan:c.plan_id,p_months:c.months,p_amount:c.amount_kobo};break;
  }
  const {data,error}=await db.rpc(rpc,args);if(error)throw Error(error.message);
  return NextResponse.json({ok:true,data},{headers:{'Cache-Control':'private, no-store'}});
 }
 const input=onboardInput.parse(raw);const {key,primary,...registration}=input;
 const brand=companyTheme(input.name,primary,input.email,input.phone);assertPublishable(brand);
 const {data,error}=await db.rpc('saas_onboard',{p_key:key,p_input:registration,p_brand:brand});
 if(error)throw Error(error.code==='23505'?'This company URL is already registered':error.message);
 return NextResponse.json({ok:true,company_id:data,redirect:`/company/${input.slug}/settings`},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
