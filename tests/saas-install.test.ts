import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
execFileSync(process.execPath,['scripts/saas-install-sql.cjs'],{stdio:'pipe'});
const sql=readFileSync('.data/supabase-first-install-iipbmwpigedfslqybxmg.sql','utf8');
async function empty(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;`);return db;}
it('installs all migrations with exact checksums and refuses replay without changing the installed database',async()=>{
 const db=await empty();try{
  await db.exec(sql);expect((await db.query("select has_schema_privilege('authenticated','edge_tenant_runtime','USAGE') allowed")).rows).toEqual([{allowed:false}]);const ledger=await db.query<{name:string;checksum:string}>('select name,checksum from edge_deploy.migrations order by name');
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();expect(ledger.rows.map(r=>r.name)).toEqual(files);
  for(const row of ledger.rows)expect(row.checksum).toBe(createHash('sha256').update(readFileSync('supabase/migrations/'+row.name)).digest('hex'));
  expect((await db.query("select relrowsecurity from pg_class where oid='saas_subdomains'::regclass")).rows).toEqual([{relrowsecurity:true}]);
  expect((await db.query("select is_updatable from information_schema.views where table_schema='public' and table_name='storefront_products'")).rows).toEqual([{is_updatable:'NO'}]);
  expect((await db.query("select has_function_privilege('authenticated','edge_deploy.request_user_id()','EXECUTE') allowed,has_table_privilege('anon','edge_deploy.auth_directory','SELECT') readable")).rows).toEqual([{allowed:false,readable:false}]);
  await db.exec('alter table auth.users add column future_managed_auth_column text');
  await expect(db.exec(sql)).rejects.toThrow('First install refused');await db.exec('rollback');expect((await db.query('select count(*)::int n from edge_deploy.migrations')).rows).toEqual([{n:files.length}]);
 }finally{await db.close();}
});
it('refuses an untracked existing dataset before installing anything and preserves the original records',async()=>{
 const db=await empty();try{
  await db.exec("create table public.existing_business(id int primary key,note text);insert into existing_business values(1,'Keep the original record')");
  await expect(db.exec(sql)).rejects.toThrow('First install refused');await db.exec('rollback');
  expect((await db.query('select * from existing_business')).rows).toEqual([{id:1,note:'Keep the original record'}]);expect((await db.query("select to_regclass('edge_deploy.migrations') present")).rows).toEqual([{present:null}]);
 }finally{await db.close();}
});
