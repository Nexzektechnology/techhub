import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {runBillingWorker} from '@/lib/billing-worker';
function authorized(req:Request){const secret=process.env.CRON_SECRET||'',provided=Buffer.from(req.headers.get('authorization')||''),expected=Buffer.from(`Bearer ${secret}`);return secret.length>=32&&provided.length===expected.length&&timingSafeEqual(provided,expected);}
export async function POST(req:Request){if(!authorized(req))return new NextResponse('Unauthorized',{status:401});try{return NextResponse.json(await runBillingWorker(),{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({error:'Worker unavailable; inspect configuration and queue state'},{status:503});}}
export const GET=POST;
