-- Real PostgreSQL boundary probe. All synthetic identities and records roll back.
-- Run with the explicitly selected SaaS remote, never an unrelated database.
begin;
set local statement_timeout='30s';
do $probe$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();
 company_a uuid:=gen_random_uuid();company_b uuid:=gen_random_uuid();
 branch_a uuid;branch_b uuid;warehouse_a text;warehouse_b text;role_id uuid;result jsonb;denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (owner_a,owner_a::text||'@hosting-probe.invalid',now()),
 (owner_b,owner_b::text||'@hosting-probe.invalid',now()),
 (staff,staff::text||'@hosting-probe.invalid',now());
 insert into public.platform_companies(id,slug,name,package,brand,brand_draft)
 select company_a,'probe-'||company_a::text,'Rollback probe A','enterprise',brand,brand from public.platform_companies where id='10000000-0000-4000-8000-000000000001';
 insert into public.platform_companies(id,slug,name,package,brand,brand_draft)
 select company_b,'probe-'||company_b::text,'Rollback probe B','enterprise',brand,brand from public.platform_companies where id='10000000-0000-4000-8000-000000000001';
 insert into public.platform_modules(company_id,module,enabled) values(company_a,'commerce',true),(company_b,'commerce',true);
 insert into public.platform_memberships(company_id,user_id,role,label) values(company_a,owner_a,'company_admin','Probe A'),(company_b,owner_b,'company_admin','Probe B'),(company_a,staff,'supervisor','Probe staff');
 perform set_config('request.jwt.claim.sub',owner_a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'aal','aal1','role','authenticated')::text,true);
 set local role authenticated;
 branch_a:=(public.tenant_commerce_command(company_a,'branch','{"name":"Probe branch A"}') ->>'id')::uuid;
 branch_b:=(public.tenant_commerce_command(company_a,'branch','{"name":"Probe branch B"}') ->>'id')::uuid;
 warehouse_a:=public.tenant_commerce_command(company_a,'warehouse',jsonb_build_object('name','Probe warehouse A','branch_id',branch_a))->>'id';
 warehouse_b:=public.tenant_commerce_command(company_a,'warehouse',jsonb_build_object('name','Probe warehouse B','branch_id',branch_b))->>'id';
 perform set_config('app.tenant_id',company_b::text,true);
 result:=public.tenant_commerce_snapshot(company_a);
 if result->>'company_id'<>company_a::text or current_setting('app.tenant_id',true)<>company_b::text then raise exception 'Company context not restored';end if;
 denied:=false;begin perform public.tenant_commerce_snapshot(company_b);exception when others then if sqlerrm like '%Forbidden%' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'Cross-company RPC allowed';end if;
 begin
  if exists(select 1 from public.tenant_branches where company_id=company_b) then raise exception 'Cross-company direct rows visible';end if;
 exception when insufficient_privilege then null;end;
 role_id:=(public.tenant_commerce_command(company_a,'role','{"name":"Warehouse reader","permissions":["inventory.read"]}')->>'id')::uuid;
 perform public.tenant_commerce_command(company_a,'binding',jsonb_build_object('user_id',staff,'role_id',role_id,'scope','warehouse','warehouse_id',warehouse_a));
 perform set_config('request.jwt.claim.sub',staff::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'aal','aal1','role','authenticated')::text,true);
 result:=public.tenant_commerce_snapshot(company_a);
 if jsonb_array_length(result->'warehouses')<>1 or result->'warehouses'->0->>'id'<>warehouse_a then raise exception 'Warehouse scope leak';end if;
 if public.tenant_permission(company_a,'inventory.read',null,warehouse_b) then raise exception 'Permission crossed warehouse boundary';end if;
 if has_schema_privilege(current_user,'edge_tenant_runtime','USAGE') then raise exception 'Private schema accessible';end if;
 reset role;
end $probe$;
select true as company_and_warehouse_boundaries_passed;
rollback;
