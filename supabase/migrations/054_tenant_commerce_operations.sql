create function public.tenant_assert(p_company uuid,p_permission text,p_branch uuid default null,p_warehouse text default null) returns void language plpgsql security invoker set search_path=public as $$ begin
 if not tenant_permission(p_company,p_permission,p_branch,p_warehouse) then raise exception 'Forbidden';end if;
 if not saas_can_write(p_company) then raise exception 'Subscription is read-only';end if;
 if p_company='10000000-0000-4000-8000-000000000001' then raise exception 'Use the existing flagship operations workspace';end if;
end $$;
create function public.tenant_stock_sync(p_company uuid,p_product text) returns void language sql security invoker set search_path=public as $$
 update products set stock=(select coalesce(sum(on_hand),0) from tenant_inventory where company_id=p_company and product_id=p_product),reserved=(select coalesce(sum(reserved),0) from tenant_inventory where company_id=p_company and product_id=p_product) where company_id=p_company and id=p_product
$$;
create function public.tenant_order_json(p_company uuid,p_order uuid) returns jsonb language sql stable security invoker set search_path=public as $$
 select to_jsonb(o)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)) from order_items i where company_id=p_company and order_id=o.id),'[]')) from orders o where company_id=p_company and id=p_order
$$;
-- Every entrypoint has a function-local tenant setting, restored by PostgreSQL
-- on success and failure. Browser-supplied IDs are selectors, never authority.
create function public.tenant_commerce_command(p_company uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public set app.tenant_id='' as $$
declare entity_id text;uid uuid;rid uuid;bid uuid;wid text;pid text;delta integer;p products;v jsonb;permissions text[];scope text;result jsonb;begin
 if not tenant_verified_user() or company_role(p_company) is null then raise exception 'Forbidden';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid command';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 case p_action
 when 'branch' then
  perform tenant_assert(p_company,'locations.manage');bid=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  insert into tenant_branches(company_id,id,name,address) values(p_company,bid,trim(p_data->>'name'),coalesce(p_data->>'address','')) on conflict(company_id,id) do update set name=excluded.name,address=excluded.address;result=jsonb_build_object('id',bid);
 when 'warehouse' then
  perform tenant_assert(p_company,'locations.manage');entity_id=coalesce(p_data->>'id',gen_random_uuid()::text);bid=(p_data->>'branch_id')::uuid;
  if not exists(select 1 from tenant_branches where company_id=p_company and id=bid and active) then raise exception 'Branch unavailable';end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 2 and 100 or length(coalesce(p_data->>'address',''))>500 then raise exception 'Invalid warehouse';end if;
  insert into warehouses(company_id,id,branch_id,name,address) values(p_company,entity_id,bid,trim(p_data->>'name'),coalesce(p_data->>'address','')) on conflict(id) do update set name=excluded.name,address=excluded.address where warehouses.company_id=p_company and warehouses.branch_id=bid;
  if not found then raise exception 'Warehouse unavailable';end if;result=jsonb_build_object('id',entity_id);
 when 'role' then
  perform tenant_assert(p_company,'team.manage');rid=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  select array_agg(value) into permissions from jsonb_array_elements_text(p_data->'permissions');
  if company_role(p_company)<>'company_admin' and coalesce((p_data->>'active')::boolean,true) and exists(select 1 from unnest(permissions) permission where not tenant_permission(p_company,permission)) then raise exception 'Cannot grant permissions beyond your own company authority';end if;
  insert into tenant_roles(company_id,id,name,permissions,active) values(p_company,rid,trim(p_data->>'name'),permissions,coalesce((p_data->>'active')::boolean,true)) on conflict(company_id,id) do update set name=excluded.name,permissions=excluded.permissions,active=excluded.active;result=jsonb_build_object('id',rid);
 when 'binding' then
  perform tenant_assert(p_company,'team.manage');uid=(p_data->>'user_id')::uuid;rid=(p_data->>'role_id')::uuid;scope=p_data->>'scope';
  if not exists(select 1 from platform_memberships where company_id=p_company and user_id=uid and active and role not in ('customer','vendor')) then raise exception 'Active employee membership required';end if;
  if uid=auth.uid() then raise exception 'Self permission changes are not allowed';end if;
  if company_role(p_company)<>'company_admin' and coalesce((p_data->>'active')::boolean,true) and exists(select 1 from tenant_roles r,unnest(r.permissions) permission where r.company_id=p_company and r.id=rid and not tenant_permission(p_company,permission,(p_data->>'branch_id')::uuid,p_data->>'warehouse_id')) then raise exception 'Cannot grant permissions beyond your own location authority';end if;
  insert into tenant_role_bindings(company_id,id,user_id,role_id,scope,branch_id,warehouse_id,active) values(p_company,coalesce((p_data->>'id')::uuid,gen_random_uuid()),uid,rid,scope,(p_data->>'branch_id')::uuid,p_data->>'warehouse_id',coalesce((p_data->>'active')::boolean,true)) on conflict(company_id,id) do update set active=excluded.active,role_id=excluded.role_id,scope=excluded.scope,branch_id=excluded.branch_id,warehouse_id=excluded.warehouse_id where tenant_role_bindings.user_id=uid;result=jsonb_build_object('ok',true);
 when 'category' then
  perform tenant_assert(p_company,'catalogue.edit');entity_id=coalesce(p_data->>'id',gen_random_uuid()::text);
  if length(trim(coalesce(p_data->>'name',''))) not between 2 and 100 then raise exception 'Invalid category';end if;
  insert into categories(company_id,id,name,image,parent_id) values(p_company,entity_id,trim(p_data->>'name'),'',nullif(p_data->>'parent_id','')) on conflict(id) do update set name=excluded.name,parent_id=excluded.parent_id where categories.company_id=p_company;
  if not found then raise exception 'Category unavailable';end if;result=jsonb_build_object('id',entity_id);
 when 'product' then
  perform tenant_assert(p_company,'catalogue.edit');entity_id=coalesce(p_data->>'id',gen_random_uuid()::text);
  if length(trim(coalesce(p_data->>'name',''))) not between 2 and 200 or coalesce(p_data->>'slug','')!~'^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_data->>'slug')>100
   or (p_data->>'price_kobo')::bigint not between 1 and 1000000000 or coalesce(p_data->>'image','')!~'^(https://|/[^/])' or coalesce(p_data->>'image','')~'[[:cntrl:]]' or length(p_data->>'image')>1000 or length(coalesce(p_data->>'description',''))>10000 then raise exception 'Invalid product';end if;
  if not exists(select 1 from categories where company_id=p_company and id=p_data->>'category_id' and archived_at is null) then raise exception 'Category unavailable';end if;
  if not coalesce(valid_options(coalesce(p_data->'options','{}')),false) or(select count(*) from jsonb_object_keys(coalesce(p_data->'options','{}')))>20 then raise exception 'Invalid product options';end if;
  for v in select jsonb_build_object('name',key,'values',value) from jsonb_each(coalesce(p_data->'options','{}')) loop
   if length(trim(v->>'name')) not between 1 and 60 or jsonb_array_length(v->'values')>30 or exists(select 1 from jsonb_array_elements_text(v->'values') x where length(x) not between 1 and 80) then raise exception 'Use option names up to 60 characters and values up to 80 characters';end if;
  end loop;
  insert into organizations(company_id,id,name,kind) select p_company,'tenant-'||p_company::text,name,'company' from platform_companies where id=p_company on conflict(id) do nothing;
  insert into merchants(company_id,id,owner_id,name,status,commission_bps) select p_company,'tenant-'||p_company::text,auth.uid(),name,'approved',0 from platform_companies where id=p_company on conflict(id) do nothing;
  insert into products(company_id,id,slug,tenant_slug,name,category_id,brand,merchant_id,merchant_name,price_kobo,image,description,options,active)
   select p_company,entity_id,p_company::text||'-'||(p_data->>'slug'),p_data->>'slug',trim(p_data->>'name'),p_data->>'category_id',coalesce(p_data->>'brand',''),'tenant-'||p_company::text,c.name,(p_data->>'price_kobo')::bigint,p_data->>'image',coalesce(p_data->>'description',''),coalesce(p_data->'options','{}'),coalesce((p_data->>'active')::boolean,false) from platform_companies c where c.id=p_company
   on conflict(id) do update set slug=excluded.slug,tenant_slug=excluded.tenant_slug,name=excluded.name,category_id=excluded.category_id,brand=excluded.brand,price_kobo=excluded.price_kobo,image=excluded.image,description=excluded.description,options=excluded.options,active=excluded.active where products.company_id=p_company;
  if not found then raise exception 'Product unavailable';end if;result=jsonb_build_object('id',entity_id);
 when 'stock' then
  wid=p_data->>'warehouse_id';pid=p_data->>'product_id';delta=(p_data->>'delta')::integer;perform tenant_assert(p_company,'inventory.adjust',null,wid);
  if delta is null or delta=0 or abs(delta::bigint)>1000000 or length(trim(coalesce(p_data->>'reason',''))) not between 5 and 500 then raise exception 'Invalid stock adjustment';end if;
  select * into p from products where company_id=p_company and products.id=pid for update;if not found then raise exception 'Product unavailable';end if;
  insert into tenant_inventory(company_id,warehouse_id,product_id,on_hand) values(p_company,wid,pid,0) on conflict do nothing;
  update tenant_inventory set on_hand=on_hand+delta where company_id=p_company and warehouse_id=wid and product_id=pid;
  insert into stock_movements(company_id,product_id,warehouse_id,quantity,reason,actor) values(p_company,pid,wid,delta,trim(p_data->>'reason'),auth.uid());
  perform tenant_stock_sync(p_company,pid);result=jsonb_build_object('ok',true);
 when 'storefront' then
  perform tenant_assert(p_company,'storefront.manage');wid=p_data->>'warehouse_id';
  if not exists(select 1 from warehouses where company_id=p_company and warehouses.id=wid and active) then raise exception 'Warehouse unavailable';end if;
  insert into tenant_storefronts(company_id,warehouse_id,delivery_kobo,published) values(p_company,wid,(p_data->>'delivery_kobo')::bigint,(p_data->>'published')::boolean) on conflict(company_id) do update set warehouse_id=excluded.warehouse_id,delivery_kobo=excluded.delivery_kobo,published=excluded.published;result=jsonb_build_object('ok',true);
 when 'order-status' then
  uid=(p_data->>'id')::uuid;select warehouse_id into wid from orders where company_id=p_company and orders.id=uid for update;if not found then raise exception 'Order unavailable';end if;
  perform tenant_assert(p_company,'orders.manage',null,wid);
  if p_data->>'status' not in ('ready_for_dispatch','delivered') then raise exception 'Invalid order status';end if;
  update orders set status=p_data->>'status' where company_id=p_company and orders.id=uid and payment_status='paid' and ((status='processing' and p_data->>'status'='ready_for_dispatch') or(status='ready_for_dispatch' and p_data->>'status'='delivered'));
  if not found then raise exception 'Invalid order transition';end if;result=jsonb_build_object('ok',true);
 else raise exception 'Invalid commerce action';end case;
 perform platform_log(p_company,'tenant.'||p_action,jsonb_build_object('result',result));return result;
end $$;

create function public.tenant_commerce_snapshot(p_company uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public set app.tenant_id='' as $$ begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) or p_page is null or p_page not between 1 and 100000 then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 return jsonb_build_object('company_id',p_company,'access',saas_access(p_company),'permissions',(select coalesce(jsonb_agg(p),'[]') from unnest(array['catalogue.read','catalogue.edit','inventory.read','inventory.adjust','orders.read','orders.manage','finance.read','finance.manage','procurement.manage','reports.read','locations.manage','team.manage','storefront.manage']) p where tenant_any_permission(p_company,p)),
 'branches',coalesce((select jsonb_agg(to_jsonb(b)) from tenant_branches b where company_id=p_company and(tenant_permission(p_company,'locations.manage') or tenant_permission(p_company,'inventory.read',b.id) or exists(select 1 from warehouses w where w.company_id=p_company and w.branch_id=b.id and tenant_permission(p_company,'inventory.read',null,w.id)))),'[]'),
 'warehouses',coalesce((select jsonb_agg(to_jsonb(w)) from warehouses w where company_id=p_company and(tenant_permission(p_company,'locations.manage') or tenant_permission(p_company,'inventory.read',null,w.id) or tenant_permission(p_company,'orders.read',null,w.id))),'[]'),
 'categories',coalesce((select jsonb_agg(to_jsonb(c)) from categories c where company_id=p_company and tenant_any_permission(p_company,'catalogue.read')),'[]'),
 'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('stock',(select coalesce(sum(i.on_hand),0) from tenant_inventory i where i.company_id=p_company and i.product_id=p.id and tenant_permission(p_company,'inventory.read',null,i.warehouse_id)),'reserved',(select coalesce(sum(i.reserved),0) from tenant_inventory i where i.company_id=p_company and i.product_id=p.id and tenant_permission(p_company,'inventory.read',null,i.warehouse_id)),'available_stock',(select coalesce(sum(i.on_hand-i.reserved),0) from tenant_inventory i where i.company_id=p_company and i.product_id=p.id and tenant_permission(p_company,'inventory.read',null,i.warehouse_id)))) from(select * from products where company_id=p_company and(tenant_any_permission(p_company,'catalogue.read') or tenant_any_permission(p_company,'inventory.read')) order by created_at desc,id limit 25 offset(p_page-1)*25)p),'[]'),
 'product_count',(select count(*) from products where company_id=p_company and(tenant_any_permission(p_company,'catalogue.read') or tenant_any_permission(p_company,'inventory.read'))),
 'inventory',coalesce((select jsonb_agg(to_jsonb(i)) from(select * from tenant_inventory where company_id=p_company and tenant_permission(p_company,'inventory.read',null,warehouse_id) order by warehouse_id,product_id limit 100 offset(p_page-1)*100)i),'[]'),
 'orders',coalesce((select jsonb_agg(tenant_order_json(p_company,o.id)) from(select * from orders where company_id=p_company and tenant_permission(p_company,'orders.read',null,warehouse_id) order by created_at desc,id limit 25 offset(p_page-1)*25)o),'[]'),
 'roles',coalesce((select jsonb_agg(to_jsonb(r)) from tenant_roles r where company_id=p_company and tenant_permission(p_company,'team.manage')),'[]'),
 'bindings',coalesce((select jsonb_agg(to_jsonb(b)) from tenant_role_bindings b where company_id=p_company and tenant_permission(p_company,'team.manage')),'[]'),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from platform_memberships m where company_id=p_company and tenant_permission(p_company,'team.manage')),'[]'),
 'storefront',(select to_jsonb(s) from tenant_storefronts s where company_id=p_company and tenant_permission(p_company,'storefront.manage')));
end $$;

alter function tenant_commerce_command(uuid,text,jsonb) owner to edge_tenant_executor;
alter function tenant_commerce_snapshot(uuid,integer) owner to edge_tenant_executor;
revoke all on function tenant_assert(uuid,text,uuid,text),tenant_stock_sync(uuid,text),tenant_order_json(uuid,uuid),tenant_commerce_command(uuid,text,jsonb),tenant_commerce_snapshot(uuid,integer) from public,anon,authenticated;
grant execute on function tenant_commerce_command(uuid,text,jsonb),tenant_commerce_snapshot(uuid,integer) to authenticated;
grant execute on all functions in schema public to edge_legacy_executor,edge_tenant_executor;
