import {NextResponse} from 'next/server';
import {resolveTxt} from 'node:dns/promises';
import {z} from 'zod';
import {guard,failure} from '@/lib/http';
import {platformIdentity} from '@/lib/platform-server';
import {service} from '@/lib/server';
import {boundedJson} from '@/lib/saas-server';
const input=z.object({company_id:z.uuid(),host:z.string().max(253).regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)}).strict();
export async function POST(req:Request){try{
 guard(req);const {db}=await platformIdentity();const c=input.parse(await boundedJson(req));
 const role=await db.rpc('saas_member_role',{p_company:c.company_id});if(role.error||role.data!=='company_admin')throw Error('Forbidden');
 const throttle=await db.rpc('saas_rate_limit',{p_action:'domain-verification'});if(throttle.error)throw Error(throttle.error.message);
 const domain=await db.from('platform_domains').select('challenge,challenge_expires_at').eq('company_id',c.company_id).eq('host',c.host).single();
 if(domain.error||!domain.data)throw Error('Domain unavailable');
 if(new Date(domain.data.challenge_expires_at).getTime()<=Date.now())throw Error('Renew the expired DNS challenge first');
 const records=await resolveTxt(`_saas-verification.${c.host}`).catch(()=>[]);
 if(!records.some(parts=>parts.join('')===`saas-verification=${domain.data.challenge}`))throw Error('DNS ownership record has not been found yet');
 const saved=await service().rpc('saas_verify_domain',{p_host:c.host,p_challenge:domain.data.challenge});if(saved.error)throw Error('Verification could not be saved');
 return NextResponse.json({ok:true,message:'Ownership verified. Hosting and HTTPS must be commissioned before activation.'},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
