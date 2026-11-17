import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
it('preserves seeded commerce counts and financial balances through ownership backfill and a local physical backup restore',async()=>{
 const db=new PGlite();let restored:PGlite|undefined;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&Number(f.slice(0,3))<52).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  await db.exec(readFileSync('supabase/seed.sql','utf8'));
  const customer=randomUUID();await db.query('insert into auth.users values($1,$2,now())',[customer,'fixture@example.com']);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[customer]);
  const order=(await db.query<{o:{reference:string;total_kobo:number}}>('select create_checkout($1) o',[{key:randomUUID(),items:[{product_id:'p-lamp',quantity:1,options:{}}],address:{name:'Fixture Customer',email:'fixture@example.com',phone:'08012345678',street:'123 Fixture Road',city:'Lagos',state:'Lagos'},coupon:''}])).rows[0].o;
  await db.query("select apply_payment($1,$2,'NGN','success')",[order.reference,order.total_kobo]);
  const snapshot=async(engine:PGlite)=>{
   const names=(await engine.query<{name:string}>("select tablename name from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.name);
   const counts:Record<string,string>={};for(const name of names)counts[name]=(await engine.query<{n:string}>(`select count(*)::text n from public."${name}"`)).rows[0].n;
   const totals=(await engine.query('select (select sum(total_kobo)::text from orders) orders,(select sum(amount_kobo)::text from payments) payments,(select sum(net_kobo)::text from merchant_ledger) ledger,(select sum(stock)::text from products) stock,(select sum(reserved)::text from products) reserved')).rows;
   return {counts,totals};
  };
  const before=await snapshot(db),backup=await db.dumpDataDir('gzip');expect(backup.size).toBeGreaterThan(0);
  await db.exec(readFileSync('supabase/migrations/052_flagship_commerce_ownership.sql','utf8'));
  expect(await snapshot(db)).toEqual(before);
  const owners=await db.query<{company_id:string}>('select distinct company_id from orders union select distinct company_id from products');expect(owners.rows).toEqual([{company_id:'10000000-0000-4000-8000-000000000001'}]);
  const otherCompany=randomUUID();await db.query("insert into platform_companies(id,slug,name) values($1,'another-company','Another Company')",[otherCompany]);
  await expect(db.query('update products set company_id=$1 where id=$2',[otherCompany,'p-lamp'])).rejects.toThrow('legacy_flagship_only');
  const constraints=await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname like 'tenant_owner_fk_%' and convalidated");expect(constraints.rows[0].n).toBeGreaterThan(30);
  restored=new PGlite({loadDataDir:backup});expect(await snapshot(restored)).toEqual(before);
  expect((await restored.query("select 1 from information_schema.columns where table_name='products' and column_name='company_id'")).rows).toEqual([]);
 }finally{await restored?.close();await db.close();}
},60000);
