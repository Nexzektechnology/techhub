import {NextResponse} from 'next/server';
import {platformIdentity} from '@/lib/platform-server';
import {failure} from '@/lib/http';
import {automaticBillingConfigured} from '@/lib/billing-authorization';
export async function GET(){try{const {db}=await platformIdentity();const r=await db.rpc('saas_operational_health');if(r.error)throw Error('Forbidden');return NextResponse.json({database:r.data,configuration:{automaticBilling:automaticBillingConfigured(),commercePayments:!!process.env.PAYSTACK_SECRET_KEY,cronAuthentication:(process.env.CRON_SECRET||'').length>=32},hostedValidation:'Run the staged acceptance and workload commands after deployment; offline evidence is not a hosted capacity certificate.'},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
