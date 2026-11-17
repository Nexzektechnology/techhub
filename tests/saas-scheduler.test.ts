import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const {schedulerSql}=createRequire(import.meta.url)('../scripts/saas-scheduler-sql.cjs');
const profile={NEXT_PUBLIC_SUPABASE_URL:'https://iipbmwpigedfslqybxmg.supabase.co',NEXT_PUBLIC_SITE_URL:'https://bizhub.example',SAAS_WORKER_URL:'https://bizhub.example/api/saas/jobs',CRON_SECRET:'ab'.repeat(32)};
it('refuses sending scheduler credentials to a different database or worker origin',()=>{
 expect(()=>schedulerSql({...profile,NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'})).toThrow('designated');
 expect(()=>schedulerSql({...profile,SAAS_WORKER_URL:'https://untrusted.example/api/saas/jobs'})).toThrow('canonical');
 expect(()=>schedulerSql({...profile,CRON_SECRET:'short'})).toThrow('secret');
});
it('keeps scheduling disabled until commissioning and credentials out of the stored job command',()=>{
 const sql=schedulerSql(profile);expect(sql).toContain('active:=false');
 const schedule=sql.slice(sql.indexOf('select cron.schedule'));
 expect(schedule).not.toContain(profile.CRON_SECRET);
 expect(schedule).toContain('edge_deploy.invoke_saas_worker()');
 expect(sql).toContain('revoke all on function edge_deploy.invoke_saas_worker() from public,anon,authenticated,service_role');
});
