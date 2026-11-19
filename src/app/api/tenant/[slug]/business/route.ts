import {NextResponse} from 'next/server';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {boundedJson} from '@/lib/saas-server';
import {businessCommand,businessFilters} from '@/lib/business-os';

type Context={params:Promise<{slug:string}>};
export async function GET(req:Request,{params}:Context){try{
 const {db}=await platformIdentity(),{slug}=await params;
 const filters=businessFilters.parse(Object.fromEntries(new URL(req.url).searchParams));
 const company=await db.rpc('company_context',{p_slug:slug});if(company.error||!company.data)throw Error('Forbidden');
 const result=await db.rpc('tenant_business_snapshot',{p_company:company.data.id,p_branch:filters.branch||null,p_query:filters.q,p_page:filters.page});
 if(result.error)throw Error(result.error.message);
 return NextResponse.json(result.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}

export async function POST(req:Request,{params}:Context){try{
 guard(req);const {db}=await platformIdentity(),{slug}=await params;
 const command=businessCommand.parse(await boundedJson(req,16000));
 const company=await db.rpc('company_context',{p_slug:slug});if(company.error||!company.data)throw Error('Forbidden');
 const limited=await db.rpc('saas_rate_limit',{p_action:'settings'});if(limited.error)throw Error(limited.error.message);
 const result=await db.rpc('tenant_business_command',{p_company:company.data.id,p_key:command.key,p_action:command.action,p_data:command.data});
 if(result.error)throw Error(result.error.message);
 return NextResponse.json({ok:true,data:result.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
