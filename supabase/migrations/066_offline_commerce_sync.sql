-- Durable actor/company-bound receipts make lost-response retries safe.
create table public.tenant_sync_receipts(
 company_id uuid not null references platform_companies(id),user_id uuid not null references profiles(id),id uuid not null,
 fingerprint text not null,target text not null,state text not null check(state in ('applied','cancelled')),result jsonb not null,
 created_at timestamptz not null default now(),primary key(company_id,user_id,id)
);
alter table tenant_sync_receipts enable row level security;
revoke all on tenant_sync_receipts from public,anon,authenticated,service_role;
grant select,insert on tenant_sync_receipts to edge_tenant_executor;
create policy sync_boundary on tenant_sync_receipts as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy sync_executor on tenant_sync_receipts for all to edge_tenant_executor using(user_id=edge_deploy.request_user_id()) with check(user_id=edge_deploy.request_user_id());

create function public.tenant_sync_target(p_action text,p_data jsonb) returns text language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_array(p_action,case when p_action<>'stock' then p_data->>'id' end,case when p_action='stock' then p_data->>'warehouse_id' end,case when p_action='stock' then p_data->>'product_id' end)::text
$$;
create function public.tenant_sync_version(p_company uuid,p_action text,p_data jsonb) returns text language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v text;begin
 if p_action='product' then select md5((to_jsonb(p)-array['stock','reserved'])::text) into v from products p where company_id=p_company and id=p_data->>'id';
 elsif p_action='stock' then select md5(jsonb_build_array(on_hand,reserved)::text) into v from tenant_inventory where company_id=p_company and warehouse_id=p_data->>'warehouse_id' and product_id=p_data->>'product_id';
 elsif p_action='order-status' then select md5(jsonb_build_array(status,payment_status)::text) into v from orders where company_id=p_company and id=(p_data->>'id')::uuid;
 else raise exception 'This action requires a connection';end if;
 return coalesce(v,'absent');end $$;
revoke all on function tenant_sync_target(text,jsonb),tenant_sync_version(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function tenant_sync_target(text,jsonb),tenant_sync_version(uuid,text,jsonb) to edge_tenant_executor;

create function public.tenant_offline_snapshot(p_company uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d jsonb;versions jsonb;begin
 d:=tenant_commerce_snapshot(p_company,p_page);
 perform set_config('app.tenant_id',p_company::text,true);
 select coalesce(jsonb_object_agg(target,version),'{}') into versions from (
  select tenant_sync_target('product',v) target,tenant_sync_version(p_company,'product',v) version from jsonb_array_elements(d->'products') v
  union all select tenant_sync_target('stock',v),tenant_sync_version(p_company,'stock',v) from jsonb_array_elements(d->'inventory') v
  union all select tenant_sync_target('order-status',v),tenant_sync_version(p_company,'order-status',v) from jsonb_array_elements(d->'orders') v
 ) v;
 -- Keep downloaded customer information to a minimum. No address/email/payment details.
 d:=jsonb_set(d,'{orders}',coalesce((select jsonb_agg(jsonb_build_object('id',o->'id','reference',o->'reference','status',o->'status','payment_status',o->'payment_status','warehouse_id',o->'warehouse_id','total_kobo',o->'total_kobo')) from jsonb_array_elements(d->'orders') o),'[]'));
 return jsonb_build_object('data',d-'members'-'roles'-'bindings'-'storefront','versions',versions,'counts',jsonb_build_object(
 'products',d->'product_count','inventory',(select count(*) from tenant_inventory where company_id=p_company and tenant_permission(p_company,'inventory.read',null,warehouse_id)),
 'orders',(select count(*) from orders where company_id=p_company and tenant_permission(p_company,'orders.read',null,warehouse_id))));
end $$;
alter function tenant_offline_snapshot(uuid,integer) owner to edge_tenant_executor;
revoke all on function tenant_offline_snapshot(uuid,integer) from public,anon,service_role;
grant execute on function tenant_offline_snapshot(uuid,integer) to authenticated;
select tenant_install_context_wrapper('public.tenant_offline_snapshot(uuid,integer)'::regprocedure);

create function public.tenant_sync_apply(p_company uuid,p_id uuid,p_action text,p_data jsonb,p_expected text,p_after uuid default null,p_cancel boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=edge_deploy.request_user_id();fp text;target_key text;r tenant_sync_receipts;previous tenant_sync_receipts;expected text;version text;result jsonb;wid text;
begin
 if not tenant_verified_user() or company_role(p_company) is null or p_id is null then raise exception 'Forbidden';end if;
 if p_action not in ('stock','product','order-status') or p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000 or length(coalesce(p_expected,''))>40 or(p_after is null and p_expected is null) or p_after=p_id or p_cancel is null then raise exception 'Invalid offline operation';end if;
 if p_action in ('product','order-status') and coalesce(length(p_data->>'id'),0)=0 then raise exception 'Offline record ID required';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 target_key:=tenant_sync_target(p_action,p_data);fp:=md5(jsonb_build_array(p_action,p_data,p_expected,p_after)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||uid::text||p_id::text,0));
 select * into r from tenant_sync_receipts where company_id=p_company and user_id=uid and id=p_id;
 if found then
  if r.fingerprint<>fp then raise exception 'Offline reference reused with different details';end if;
  return r.result;
 end if;
 if p_cancel then
  result:=jsonb_build_object('state','cancelled','id',p_id);
  insert into tenant_sync_receipts(company_id,user_id,id,fingerprint,target,state,result) values(p_company,uid,p_id,fp,target_key,'cancelled',result);return result;
 end if;
 -- Permissions and subscription are checked again at the time of posting.
 if p_action='stock' then
  wid:=p_data->>'warehouse_id';perform tenant_assert(p_company,'inventory.adjust',null,wid);
  perform 1 from products where company_id=p_company and id=p_data->>'product_id' for update;
  perform 1 from tenant_inventory where company_id=p_company and warehouse_id=wid and product_id=p_data->>'product_id' for update;
 elsif p_action='product' then
  perform tenant_assert(p_company,'catalogue.edit');
  perform 1 from products where company_id=p_company and id=p_data->>'id' for update;
 else
  select warehouse_id into wid from orders where company_id=p_company and id=(p_data->>'id')::uuid for update;
  perform tenant_assert(p_company,'orders.manage',null,wid);
 end if;
 expected:=p_expected;
 if p_after is not null then
  select * into previous from tenant_sync_receipts where company_id=p_company and user_id=uid and id=p_after and target=target_key;
  if not found or previous.state<>'applied' then raise exception 'Earlier offline change needs synchronization or review';end if;
  expected:=previous.result->>'version';
 end if;
 version:=tenant_sync_version(p_company,p_action,p_data);
 if version is distinct from expected then raise exception 'Offline conflict: this record changed online. Review the latest values before posting a new change';end if;
 result:=tenant_commerce_command(p_company,p_action,p_data);
 result:=jsonb_build_object('state','applied','id',p_id,'data',result,'version',tenant_sync_version(p_company,p_action,p_data));
 insert into tenant_sync_receipts(company_id,user_id,id,fingerprint,target,state,result) values(p_company,uid,p_id,fp,target_key,'applied',result);
 return result;
end $$;
alter function tenant_sync_apply(uuid,uuid,text,jsonb,text,uuid,boolean) owner to edge_tenant_executor;
revoke all on function tenant_sync_apply(uuid,uuid,text,jsonb,text,uuid,boolean) from public,anon,service_role;
grant execute on function tenant_sync_apply(uuid,uuid,text,jsonb,text,uuid,boolean) to authenticated;
select tenant_install_context_wrapper('public.tenant_sync_apply(uuid,uuid,text,jsonb,text,uuid,boolean)'::regprocedure);
