import {NextResponse} from 'next/server';
import {z} from 'zod';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {boundedJson} from '@/lib/saas-server';
import {paystack} from '@/lib/paystack';
export async function POST(req:Request){try{
 guard(req);const {db}=await platformIdentity();const allowed=await db.rpc('platform_is_admin');if(allowed.error||!allowed.data)throw Error('Forbidden');
 const input=z.object({company_id:z.uuid(),subaccount:z.string().regex(/^ACCT_[A-Za-z0-9]+$/)}).strict().parse(await boundedJson(req));
 const account=await paystack(`/subaccount/${encodeURIComponent(input.subaccount)}`);if(account.subaccount_code!==input.subaccount||account.is_verified!==true||account.active===false)throw Error('A verified active Paystack subaccount is required');
 const saved=await db.rpc('tenant_link_payment_account',{p_company:input.company_id,p_code:input.subaccount,p_name:account.business_name});if(saved.error)throw Error(saved.error.message);
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
