// Generate a private, project-bound Supabase Cron installation. Does not execute SQL.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
const target=require('../config/saas-deployment.json');
function schedulerSql(env){
 if(env.NEXT_PUBLIC_SUPABASE_URL!==`https://${target.supabaseProjectRef}.supabase.co`)throw Error('Scheduler profile must identify the designated Supabase project');
 const origin=new URL(env.NEXT_PUBLIC_SITE_URL||'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||require('node:net').isIP(origin.hostname)||origin.hostname==='localhost')throw Error('Use the canonical public HTTPS origin');
 if(env.SAAS_WORKER_URL!==`${origin.origin}/api/saas/jobs`)throw Error('Scheduler must call the canonical worker endpoint');
 if(!/^[a-f0-9]{64}$/.test(env.CRON_SECRET||''))throw Error('Use a private 32-byte hex scheduler secret');
 const literal=s=>"'"+s.replaceAll("'","''")+"'";
 return `-- PRIVATE: contains a scheduler credential. Never commit or publish this file.
-- Target: ${target.supabaseProjectRef}. Run only with an explicitly selected remote.
begin;
select pg_advisory_xact_lock(hashtext('bizhub-scheduler-setup'));
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
revoke all on schema net,cron from public,anon,authenticated;
grant usage on schema cron to postgres;
grant all on all tables in schema cron to postgres;
do $vault_setup$ declare existing uuid;begin
 select id into existing from vault.secrets where name='bizhub_worker_auth';
 if existing is null then perform vault.create_secret(${literal(env.CRON_SECRET)},'bizhub_worker_auth','BizHub authenticated worker');
 else perform vault.update_secret(existing,${literal(env.CRON_SECRET)},'bizhub_worker_auth','BizHub authenticated worker');end if;
end $vault_setup$;
create or replace function edge_deploy.invoke_saas_worker() returns bigint language plpgsql security invoker set search_path=pg_catalog as $worker$
declare secret text;request_id bigint;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='bizhub_worker_auth';
 if length(coalesce(secret,''))<32 then raise exception 'Worker authentication unavailable';end if;
 select net.http_post(url:=${literal(env.SAAS_WORKER_URL)},headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end $worker$;
revoke all on function edge_deploy.invoke_saas_worker() from public,anon,authenticated,service_role;
-- Keep disabled until an authenticated HTTP invocation and heartbeat pass.
select cron.schedule('bizhub-billing-and-inventory','*/5 * * * *','select edge_deploy.invoke_saas_worker();');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='bizhub-billing-and-inventory';
commit;
select jobname,schedule,active from cron.job where jobname='bizhub-billing-and-inventory';
`;
}
module.exports={schedulerSql};
if(require.main===module){
 try{const profile=path.resolve(process.argv[2]||'.env.saas.local');const sql=schedulerSql(parseEnv(fs.readFileSync(profile,'utf8')));const output=path.resolve('.data',`supabase-scheduler-${target.supabaseProjectRef}-private.sql`);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,sql,{mode:0o600});console.log(JSON.stringify({file:output,project:target.supabaseProjectRef,active:false,hosted_changes:false}));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
