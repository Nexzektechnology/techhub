import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {companyTheme} from '../../src/lib/saas-contract';
export const FLAGSHIP='10000000-0000-4000-8000-000000000001';
export const actors={root:'61000000-0000-4000-8000-000000000001',a:'61000000-0000-4000-8000-000000000002',b:'61000000-0000-4000-8000-000000000003',staff:'61000000-0000-4000-8000-000000000004',customer:'61000000-0000-4000-8000-000000000005'};
export async function tenantDatabase(through=Number.POSITIVE_INFINITY){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;`);
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&Number.parseInt(f,10)<=through).sort()){try{await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));}catch(error){if(error instanceof Error)error.message=`${file}: ${error.message}`;throw error;}}
 for(const [key,id] of Object.entries(actors))await db.query('insert into auth.users values($1,$2,now())',[id,`${key}@tenant.example`]);
 await db.query('insert into platform_admins(user_id) values($1)',[actors.root]);
 return db;
}
export async function identity<T>(db:PGlite,id:string,fn:()=>Promise<T>,role='authenticated',aal='aal1'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,aal})]);await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}
}
export async function value<T=string>(db:PGlite,sql:string,args:unknown[]=[]){return(await db.query<{v:T}>(sql,args)).rows[0].v;}
export async function company(db:PGlite,owner:string,slug:string){
 const cid=await identity(db,actors.root,()=>value(db,'select platform_create_company($1,$2,$3,$4,$5) v',[slug,slug,`${owner}@tenant.example`,'enterprise',companyTheme(slug,'#2457C5',`${owner}@tenant.example`,'')]),'authenticated','aal2');
 await db.query("update platform_modules set enabled=true where company_id=$1 and module='commerce'",[cid]);return cid;
}
