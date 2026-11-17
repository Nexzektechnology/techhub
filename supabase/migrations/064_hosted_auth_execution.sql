-- Supabase's managed Auth schema grants postgres USAGE without GRANT OPTION.
-- Private execution roles therefore use narrowly granted application bridges;
-- they do not inherit browser roles or require managed-schema grants.
create schema if not exists edge_deploy;
revoke all on schema edge_deploy from public,anon,authenticated,service_role;
grant usage on schema edge_deploy to edge_legacy_executor,edge_tenant_executor;
create function edge_deploy.request_user_id() returns uuid language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid()
$$;
revoke all on function edge_deploy.request_user_id() from public,anon,authenticated,service_role;
grant execute on function edge_deploy.request_user_id() to edge_legacy_executor,edge_tenant_executor;

-- Do not depend on auth.users' whole composite row: future managed Auth
-- migrations must remain able to add columns to that table.
do $directory$ begin
 if exists(select 1 from pg_attribute where attrelid='auth.users'::regclass and attname='is_anonymous' and not attisdropped) then
  execute 'create view edge_deploy.auth_directory with(security_barrier=true) as select u.id,u.email,u.email_confirmed_at,coalesce(u.is_anonymous,false) as is_anonymous from auth.users u';
 else
  execute 'create view edge_deploy.auth_directory with(security_barrier=true) as select u.id,u.email,u.email_confirmed_at,false as is_anonymous from auth.users u';
 end if;
end $directory$;
revoke all on edge_deploy.auth_directory from public,anon,authenticated,service_role,edge_tenant_executor;
grant select on edge_deploy.auth_directory to edge_legacy_executor;
revoke select on auth.users from edge_legacy_executor;

do $adapt_private_roles$ declare f record;definition text;source text;begin
 for f in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','edge_tenant_runtime') and pg_get_userbyid(p.proowner) in ('edge_legacy_executor','edge_tenant_executor')
  and(p.prosrc like '%auth.uid()%' or p.prosrc like '%auth.users%')
 loop
  if exists(select 1 from public.tenant_legacy_routines m where to_regprocedure(m.signature)=f.oid and m.source_md5<>md5(f.prosrc)) then raise exception 'Existing legacy routine integrity mismatch';end if;
  definition:=pg_get_functiondef(f.oid);
  source:=replace(replace(f.prosrc,'auth.uid()','edge_deploy.request_user_id()'),'auth.users','edge_deploy.auth_directory');
  if length(f.prosrc)=0 or (length(definition)-length(replace(definition,f.prosrc,'')))/length(f.prosrc)<>1 then raise exception 'Unexpected private identity definition';end if;
  execute replace(definition,f.prosrc,source);
  update public.tenant_legacy_routines set source_md5=md5(source) where to_regprocedure(signature)=f.oid;
 end loop;
end $adapt_private_roles$;
