-- Private execution roles keep legacy definer routines inside the flagship boundary.
-- Neither role is granted to anon, authenticated, service_role or authenticator.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='edge_legacy_executor') then create role edge_legacy_executor nologin noinherit nobypassrls;end if;
 if not exists(select 1 from pg_roles where rolname='edge_tenant_executor') then create role edge_tenant_executor nologin noinherit nobypassrls;end if;
end $$;
grant edge_legacy_executor,edge_tenant_executor to postgres;
grant usage,create on schema public to edge_legacy_executor,edge_tenant_executor;
grant usage on schema auth to edge_legacy_executor,edge_tenant_executor;
grant execute on function auth.uid() to edge_legacy_executor,edge_tenant_executor;
-- Existing approved-email invitation/import RPCs resolve verified Auth identities.
-- This private role is never granted to a browser or PostgREST session role.
grant select on auth.users to edge_legacy_executor;

-- Hosted PostgreSQL owners are not superusers and cannot put an undeclared
-- custom parameter in a function SET clause. Keep implementations inaccessible
-- and install public wrappers with explicit restoration on every exit path.
create schema edge_tenant_runtime;
revoke all on schema edge_tenant_runtime from public,anon,authenticated,service_role;
grant usage on schema edge_tenant_runtime to edge_tenant_executor;
create function public.tenant_install_context_wrapper(p_function regprocedure) returns void language plpgsql security invoker set search_path=public,pg_temp as $installer$
declare f pg_proc;definition text;implementation text;signature text;arguments text;body text;result_type text;invoke_sql text;return_sql text;result_declaration text;
begin
 if current_user<>'postgres' then raise exception 'Migration owner required';end if;
 select * into f from pg_proc where oid=p_function;
 if f.pronamespace<>'public'::regnamespace or not f.prosecdef or pg_get_userbyid(f.proowner)<>'edge_tenant_executor' or f.proretset or f.proargmodes is not null or f.prorettype not in ('jsonb'::regtype,'integer'::regtype,'void'::regtype) then raise exception 'Unsupported tenant context entrypoint';end if;
 if f.prosrc like '%edge_prior_tenant_setting%' then return;end if;
 definition:=pg_get_functiondef(f.oid);
 if length(f.prosrc)=0 or (length(definition)-length(replace(definition,f.prosrc,'')))/length(f.prosrc)<>1 then raise exception 'Unexpected tenant entrypoint definition';end if;
 implementation:=regexp_replace(definition,'^CREATE OR REPLACE FUNCTION public[.]','CREATE OR REPLACE FUNCTION edge_tenant_runtime.');
 if implementation=definition then raise exception 'Unexpected tenant function namespace';end if;
 execute implementation;
 signature:=format('edge_tenant_runtime.%I(%s)',f.proname,oidvectortypes(f.proargtypes));
 grant create on schema edge_tenant_runtime to edge_tenant_executor;
 execute format('alter function %s owner to edge_tenant_executor',signature);
 revoke create on schema edge_tenant_runtime from edge_tenant_executor;
 execute format('alter function %s set search_path=public,pg_temp',signature);
 execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
 execute format('grant execute on function %s to edge_tenant_executor',signature);
 select coalesce(string_agg('$'||position,',' order by position),'') into arguments from generate_series(1,f.pronargs) as parameters(position);
 result_type:=pg_get_function_result(f.oid);
 if result_type='void' then result_declaration:='';invoke_sql:=format('perform edge_tenant_runtime.%I(%s);',f.proname,arguments);return_sql:='return;';
 else result_declaration:=format('edge_return_value %s;',result_type);invoke_sql:=format('edge_return_value:=edge_tenant_runtime.%I(%s);',f.proname,arguments);return_sql:='return edge_return_value;';end if;
 body:=format($wrapper$
declare edge_prior_tenant_setting text:=current_setting('app.tenant_id',true);%s
begin
 perform set_config('app.tenant_id','',true);
 %s
 perform set_config('app.tenant_id',coalesce(edge_prior_tenant_setting,''),true);
 %s
exception when others then
 perform set_config('app.tenant_id',coalesce(edge_prior_tenant_setting,''),true);
 raise;
end
$wrapper$,result_declaration,invoke_sql,return_sql);
 execute replace(definition,f.prosrc,body);
end $installer$;
revoke all on function tenant_install_context_wrapper(regprocedure) from public,anon,authenticated,service_role;
grant execute on function tenant_install_context_wrapper(regprocedure) to postgres;

create table public.tenant_branches(company_id uuid not null references platform_companies(id),id uuid not null default gen_random_uuid(),name text not null check(length(trim(name)) between 2 and 100),address text not null default '' check(length(address)<=500),active boolean not null default true,primary key(company_id,id));
alter table warehouses add column branch_id uuid;
alter table warehouses add constraint tenant_warehouse_branch foreign key(company_id,branch_id) references tenant_branches(company_id,id);
create index tenant_warehouse_branch_idx on warehouses(company_id,branch_id,id);
create table public.tenant_roles(company_id uuid not null references platform_companies(id),id uuid not null default gen_random_uuid(),name text not null check(length(trim(name)) between 2 and 80),permissions text[] not null check(cardinality(permissions) between 1 and 20 and permissions<@array['catalogue.read','catalogue.edit','inventory.read','inventory.adjust','orders.read','orders.manage','finance.read','finance.manage','procurement.manage','reports.read','locations.manage','team.manage','storefront.manage']),active boolean not null default true,primary key(company_id,id),unique(company_id,name));
create table public.tenant_role_bindings(company_id uuid not null,user_id uuid not null,role_id uuid not null,scope text not null check(scope in ('company','branch','warehouse')),branch_id uuid,warehouse_id text,id uuid not null default gen_random_uuid(),active boolean not null default true,primary key(company_id,id),foreign key(company_id,user_id) references platform_memberships(company_id,user_id),foreign key(company_id,role_id) references tenant_roles(company_id,id),foreign key(company_id,branch_id) references tenant_branches(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),check((scope='company' and branch_id is null and warehouse_id is null) or(scope='branch' and branch_id is not null and warehouse_id is null) or(scope='warehouse' and warehouse_id is not null and branch_id is null)));
create index tenant_binding_actor on tenant_role_bindings(company_id,user_id) where active;
alter table tenant_roles add constraint tenant_role_read_dependencies check((not('inventory.adjust'=any(permissions)) or 'inventory.read'=any(permissions)) and(not('catalogue.edit'=any(permissions)) or 'catalogue.read'=any(permissions)));
create table public.tenant_inventory(company_id uuid not null,warehouse_id text not null,product_id text not null,on_hand integer not null default 0 check(on_hand>=0),reserved integer not null default 0 check(reserved between 0 and on_hand),primary key(company_id,warehouse_id,product_id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,product_id) references products(company_id,id));
create index tenant_inventory_product on tenant_inventory(company_id,product_id,warehouse_id);
create table public.tenant_storefronts(company_id uuid primary key references platform_companies(id),warehouse_id text,delivery_kobo bigint not null default 0 check(delivery_kobo between 0 and 100000000),published boolean not null default false,foreign key(company_id,warehouse_id) references warehouses(company_id,id),check(not published or warehouse_id is not null));
create table public.tenant_legacy_routines(signature text primary key,previous_owner text not null,source_md5 text not null);
alter table products add column tenant_slug text check(tenant_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tenant_slug)<=100);
create unique index tenant_product_slug on products(company_id,tenant_slug) where tenant_slug is not null;
alter table orders add column branch_id uuid;
alter table orders add column warehouse_id text;
alter table orders add constraint tenant_order_branch foreign key(company_id,branch_id) references tenant_branches(company_id,id);
alter table orders add constraint tenant_order_warehouse foreign key(company_id,warehouse_id) references warehouses(company_id,id);
create index tenant_order_scope on orders(company_id,warehouse_id,created_at desc,id);

create function public.tenant_verified_user() returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'true'
$$;
create function public.tenant_permission(p_company uuid,p_permission text,p_branch uuid default null,p_warehouse text default null) returns boolean language plpgsql stable security definer set search_path=public as $$
declare branch uuid:=p_branch;begin
 if not tenant_verified_user() or company_role(p_company) is null then return false;end if;
 if p_warehouse is not null then select branch_id into branch from warehouses where company_id=p_company and id=p_warehouse and active;if not found then return false;end if;end if;
 if branch is not null and not exists(select 1 from tenant_branches where company_id=p_company and id=branch and active) then return false;end if;
 if company_role(p_company)='company_admin' then return true;end if;
 return exists(select 1 from tenant_role_bindings b join tenant_roles r on r.company_id=b.company_id and r.id=b.role_id where b.company_id=p_company and b.user_id=auth.uid() and b.active and r.active and p_permission=any(r.permissions)
 and(b.scope='company' or(b.scope='branch' and branch is not null and b.branch_id=branch) or(b.scope='warehouse' and p_warehouse is not null and b.warehouse_id=p_warehouse)));
end $$;
create function public.tenant_any_permission(p_company uuid,p_permission text) returns boolean language sql stable security definer set search_path=public as $$
 select tenant_permission(p_company,p_permission) or(tenant_verified_user() and company_role(p_company) is not null and exists(select 1 from tenant_role_bindings b join tenant_roles r on r.company_id=b.company_id and r.id=b.role_id where b.company_id=p_company and b.user_id=auth.uid() and b.active and r.active and p_permission=any(r.permissions) and(b.scope='company' or(b.scope='branch' and exists(select 1 from tenant_branches l where l.company_id=b.company_id and l.id=b.branch_id and l.active)) or(b.scope='warehouse' and exists(select 1 from warehouses w join tenant_branches l on l.company_id=w.company_id and l.id=w.branch_id where w.company_id=b.company_id and w.id=b.warehouse_id and w.active and l.active)))))
$$;
create function public.tenant_row_boundary(p_company uuid) returns boolean language sql stable security invoker set search_path=public as $$
 select case when current_user='edge_tenant_executor' then p_company=nullif(current_setting('app.tenant_id',true),'')::uuid else p_company='10000000-0000-4000-8000-000000000001'::uuid end
$$;
-- Tenant selectors can be set only inside validated entrypoints, and their SET
-- clauses restore context on return/error. Direct authenticated SQL remains flagship-bound.
do $$ declare t text;r record;tables text[]:=array['organizations','merchants','categories','brands','products','warehouses','suppliers','purchase_orders','addresses','coupons','orders','order_items','order_allocations','stock_movements','stock_reservations','idempotency_records','payments','payment_webhooks','refunds','merchant_ledger','settlements','delivery_jobs','delivery_events','returns','reviews','customer_wishlist','product_deals','payment_initializations'];pattern text;begin
 -- Capture and constrain every existing privileged routine touching the opened graph or its facades.
 pattern='\m('||array_to_string(tables,'|')||'|operational_records|storefront_products|inventory)\M';
 for r in select p.oid,p.oid::regprocedure::text signature,p.prosrc,pg_get_userbyid(p.proowner) owner from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.prosrc~pattern and p.proname!~'^(saas_|tenant_)' and p.proname not in ('approved_merchant','commerce_can','guard_deleted_directory') loop
  insert into tenant_legacy_routines values(r.signature,r.owner,md5(r.prosrc));
  execute format('alter function %s owner to edge_legacy_executor',r.signature);
 end loop;
 foreach t in array tables loop
  execute format('alter table public.%I drop constraint legacy_flagship_only',t);
  execute format('drop policy legacy_company_boundary on public.%I',t);
  execute format('create policy tenant_company_boundary on public.%I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on public.%I for all to edge_tenant_executor using(true) with check(true)',t);
 end loop;
 -- Existing routines keep their own original authorization, with RLS preventing
 -- any of them (including global-admin exports) from seeing a new tenant's commerce.
 for r in select tablename from pg_tables where schemaname='public' and tablename not like 'saas_%' and tablename not like 'tenant_%' loop
  execute format('create policy legacy_executor_access on public.%I for all to edge_legacy_executor using(true) with check(true)',r.tablename);
 end loop;
end $$;
-- These two RLS predicates run with trusted ownership, but explicitly constrain
-- their legacy records so a new company's metadata cannot affect flagship grants.
create or replace function public.approved_merchant(p_id text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from merchants where id=p_id and company_id='10000000-0000-4000-8000-000000000001' and status='approved') $$;

do $$ declare t text;begin foreach t in array array['tenant_branches','tenant_roles','tenant_role_bindings','tenant_inventory','tenant_storefronts','tenant_legacy_routines'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
 if t<>'tenant_legacy_routines' then
  execute format('create policy tenant_company_boundary on public.%I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on public.%I for all to edge_tenant_executor using(true) with check(true)',t);
 end if;
end loop;end $$;
grant select,insert,update,delete on all tables in schema public to edge_legacy_executor,edge_tenant_executor;
grant usage,select on all sequences in schema public to edge_legacy_executor,edge_tenant_executor;
grant execute on all functions in schema public to edge_legacy_executor,edge_tenant_executor;
revoke all on function tenant_verified_user(),tenant_permission(uuid,text,uuid,text),tenant_any_permission(uuid,text),tenant_row_boundary(uuid) from public,anon,authenticated;
grant execute on function tenant_row_boundary(uuid) to anon,authenticated;
grant execute on function tenant_permission(uuid,text,uuid,text),tenant_any_permission(uuid,text) to authenticated;
