// First-install fallback for the designated project's SQL editor. Never changes a hosted database itself.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {supabaseProjectRef}=require('../config/saas-deployment.json');
const migrations=fs.readdirSync('supabase/migrations').filter(name=>/^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name=>{const sql=fs.readFileSync(path.join('supabase/migrations',name),'utf8');return {name,sql,checksum:crypto.createHash('sha256').update(sql).digest('hex')};});
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const header=`-- FIRST INSTALL ONLY: Supabase project ${supabaseProjectRef}.
-- Open https://supabase.com/dashboard/project/${supabaseProjectRef}/sql/new and verify the project first.
-- This installer refuses existing public tables or an earlier application migration ledger.
-- Existing datasets require the regular reconciled migration runner and verified backup/restore evidence.
-- All migrations and their checksums commit together. An error rolls the installation back.
begin;
select pg_advisory_xact_lock(hashtext('edgedirect2u-migrations'));
do $first_install_guard$ begin
 if exists(select 1 from pg_tables where schemaname='public') or to_regclass('edge_deploy.migrations') is not null then
  raise exception 'First install refused: existing application schema detected. Use the reconciled migration workflow; no migration was applied.';
 end if;
end $first_install_guard$;
create schema edge_deploy;
revoke all on schema edge_deploy from public,anon,authenticated;
create table edge_deploy.migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now());
`;
const body=migrations.map(m=>`\n-- ${m.name}\n${m.sql}\ninsert into edge_deploy.migrations(name,checksum) values(${literal(m.name)},${literal(m.checksum)});\n`).join('');
const tail=`\nnotify pgrst,'reload schema';\ncommit;\nselect count(*) as applied_migrations from edge_deploy.migrations;\n`;
const output=path.resolve('.data',`supabase-first-install-${supabaseProjectRef}.sql`);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,header+body+tail);
console.log(JSON.stringify({file:output,migrations:migrations.length,mode:'first-install-only',hosted_changes:false}));
