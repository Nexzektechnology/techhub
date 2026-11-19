-- Additive business master and retry-safe stock foundation. Exact money stays in kobo.
set local lock_timeout='5s';
-- Upgrade independently of historical migration edits: older storefront views
-- depend on products' entire composite row type. Preserve their current column
-- interface, grants, owner, invoker security, pricing and read-only behavior
-- before extending products; never expose new cost columns through SELECT *.
do $$ declare projection text;begin
 select string_agg(case a.attname
  when 'price_kobo' then 'coalesce(public.effective_product_price(p.id),p.price_kobo)'
  when 'previous_price_kobo' then 'case when public.effective_product_price(p.id)<p.price_kobo then p.price_kobo else p.previous_price_kobo end'
  when 'regular_price_kobo' then 'p.price_kobo'
  else format('p.%I',a.attname)
 end||format(' as %I',a.attname),',' order by a.attnum) into projection
 from pg_attribute a where a.attrelid='public.storefront_products'::regclass and a.attnum>0 and not a.attisdropped;
 if projection is null then raise exception 'Storefront view unavailable';end if;
 execute 'create or replace view public.storefront_products with(security_invoker=true) as with storefront_projection as not materialized (select '||projection||' from public.products p) select * from storefront_projection';
end $$;
alter table products add column sku text check(length(sku) between 1 and 80);
alter table products add column barcode text check(length(barcode) between 1 and 100);
alter table products add column cost_kobo bigint not null default 0 check(cost_kobo between 0 and 1000000000);
alter table products add column wholesale_kobo bigint check(wholesale_kobo between 1 and 1000000000);
alter table products add column minimum_price_kobo bigint not null default 0 check(minimum_price_kobo between 0 and 1000000000);
alter table products add column supplier_id text;
alter table products add constraint business_product_supplier foreign key(company_id,supplier_id) references suppliers(company_id,id);
create unique index business_product_sku on products(company_id,lower(sku)) where sku is not null;
create unique index business_product_barcode on products(company_id,barcode) where barcode is not null;
alter table suppliers add column active boolean not null default true;
alter table suppliers add column notes text not null default '' check(length(notes)<=2000);

-- Auth identities are optional: walk-in/B2B customers need no login account.
create table public.tenant_customers(
 company_id uuid not null references platform_companies(id),id uuid not null default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 200),email text not null default '' check(length(email)<=254),
 phone text not null default '' check(length(phone)<=40),address text not null default '' check(length(address)<=500),
 notes text not null default '' check(length(notes)<=2000),active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(company_id,id)
);
create index business_customer_directory on tenant_customers(company_id,lower(name),id);
create index business_supplier_directory on suppliers(company_id,lower(name),id);
-- Receipts and movements commit together. A response lost in transit is safely replayable.
create table public.tenant_business_commands(
 company_id uuid not null references platform_companies(id),id uuid not null,actor uuid not null references profiles(id),
 action text not null check(action in ('customer','supplier','product-master','stock')),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(company_id,id)
);
alter table stock_movements add column command_id uuid;
-- Existing expiry events release a reservation without adding physical stock.
alter table stock_movements add column movement_kind text not null default 'physical' check(movement_kind in ('physical','reservation_release'));
update stock_movements set movement_kind='reservation_release' where order_id is not null and reason='Reservation expired';
create function public.business_classify_movement() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if new.order_id is not null and new.reason='Reservation expired' then new.movement_kind='reservation_release';end if;
 return new;
end $$;
create trigger business_movement_classify before insert on stock_movements for each row execute function business_classify_movement();
alter table stock_movements add constraint business_movement_command foreign key(company_id,command_id) references tenant_business_commands(company_id,id) deferrable initially deferred;
create unique index business_movement_once on stock_movements(company_id,command_id) where command_id is not null;
create index business_movement_timeline on stock_movements(company_id,warehouse_id,created_at desc,id);

-- The older snapshot serialized entire product rows. New private master fields
-- must not become visible to an inventory-only employee through that API.
alter function tenant_commerce_snapshot(uuid,integer) rename to tenant_commerce_snapshot_pre_business;
revoke all on function tenant_commerce_snapshot_pre_business(uuid,integer) from public,anon,authenticated;
create function public.tenant_commerce_snapshot(p_company uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb;begin
 snapshot=tenant_commerce_snapshot_pre_business(p_company,p_page);
 return jsonb_set(snapshot,'{products}',coalesce((select jsonb_agg(p-array['cost_kobo','wholesale_kobo','minimum_price_kobo','supplier_id']) from jsonb_array_elements(snapshot->'products') p),'[]'));
end $$;
alter function tenant_commerce_snapshot(uuid,integer) owner to edge_tenant_executor;
revoke all on function tenant_commerce_snapshot(uuid,integer) from public,anon,authenticated;
grant execute on function tenant_commerce_snapshot(uuid,integer) to authenticated;

do $$ declare t text;begin
 foreach t in array array['tenant_customers','tenant_business_commands'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on public.%I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on public.%I for all to edge_tenant_executor using(true) with check(true)',t);
 end loop;
end $$;
grant select,insert,update on tenant_customers to edge_tenant_executor;
grant select,insert on tenant_business_commands to edge_tenant_executor;

create function public.business_immutable_evidence() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_table_name='tenant_business_commands' or old.company_id<>'10000000-0000-4000-8000-000000000001' then
  raise exception 'Posted evidence is immutable; record a compensating transaction';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger business_command_immutable before update or delete on tenant_business_commands for each row execute function business_immutable_evidence();
create trigger business_movement_immutable before update or delete on stock_movements for each row execute function business_immutable_evidence();

create function public.tenant_business_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;result jsonb;entity text;wid text;pid text;delta integer;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_key is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid command';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 case p_action
 when 'customer' then perform tenant_assert(p_company,'orders.manage');
 when 'supplier' then perform tenant_assert(p_company,'procurement.manage');
 when 'product-master' then perform tenant_assert(p_company,'catalogue.edit');
 when 'stock' then perform tenant_assert(p_company,'inventory.adjust',null,p_data->>'warehouse_id');
 else raise exception 'Invalid business action';end case;
 -- Serializes concurrent retries before reading a receipt; product locks separately
 -- serialize new movement keys against reservations and other stock writers.
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if found then
  if prior.actor<>auth.uid() or prior.action<>p_action or prior.payload<>p_data then raise exception 'Idempotency key already used with different input';end if;
  return prior.result;
 end if;
 if p_action in ('customer','supplier') then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or exists(select 1 from unnest(array['email','phone','address','notes']) k where p_data ? k and jsonb_typeof(p_data->k)<>'string')
   or not(p_data ? 'name') or length(trim(coalesce(p_data->>'name',''))) not between 2 and 200
   or length(coalesce(p_data->>'email',''))>254 or(coalesce(p_data->>'email','')<>'' and p_data->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or length(coalesce(p_data->>'phone',''))>40 or length(coalesce(p_data->>'address',''))>500 or length(coalesce(p_data->>'notes',''))>2000
   or(p_data ? 'active' and jsonb_typeof(p_data->'active')<>'boolean') then raise exception 'Invalid contact';end if;
  if p_action='customer' then
   entity=coalesce((p_data->>'id')::uuid,gen_random_uuid())::text;
   if p_data ? 'id' and not exists(select 1 from tenant_customers where company_id=p_company and id=entity::uuid) then raise exception 'Customer unavailable';end if;
   insert into tenant_customers(company_id,id,name,email,phone,address,notes,active)
   values(p_company,entity::uuid,trim(p_data->>'name'),lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')),trim(coalesce(p_data->>'address','')),coalesce(p_data->>'notes',''),coalesce((p_data->>'active')::boolean,true))
   on conflict(company_id,id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,address=excluded.address,notes=excluded.notes,active=excluded.active,updated_at=now();
  else
   entity=coalesce(p_data->>'id',gen_random_uuid()::text);
   if p_data ? 'id' and not exists(select 1 from suppliers where company_id=p_company and id=entity) then raise exception 'Supplier unavailable';end if;
   insert into suppliers(company_id,id,name,email,phone,address,notes,active)
   values(p_company,entity,trim(p_data->>'name'),lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')),trim(coalesce(p_data->>'address','')),coalesce(p_data->>'notes',''),coalesce((p_data->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,address=excluded.address,notes=excluded.notes,active=excluded.active where suppliers.company_id=p_company;
  end if;
  result=jsonb_build_object('id',entity);
 elsif p_action='product-master' then
  pid=p_data->>'id';
  if not exists(select 1 from products where company_id=p_company and id=pid and archived_at is null) then raise exception 'Product unavailable';end if;
  if length(trim(coalesce(p_data->>'sku',''))) not between 1 and 80 or length(coalesce(p_data->>'barcode',''))>100
   or coalesce(p_data->>'cost_kobo','')!~'^[0-9]{1,10}$' or coalesce(p_data->>'minimum_price_kobo','')!~'^[0-9]{1,10}$'
   or coalesce(p_data->>'reorder_level','')!~'^[0-9]{1,7}$'
   or(p_data->>'wholesale_kobo' is not null and p_data->>'wholesale_kobo'!~'^[0-9]{1,10}$') then raise exception 'Invalid product master';end if;
  if nullif(p_data->>'supplier_id','') is not null and not exists(select 1 from suppliers where company_id=p_company and id=p_data->>'supplier_id' and active) then raise exception 'Supplier unavailable';end if;
  update products set sku=trim(p_data->>'sku'),barcode=nullif(trim(p_data->>'barcode'),''),cost_kobo=(p_data->>'cost_kobo')::bigint,
   wholesale_kobo=(p_data->>'wholesale_kobo')::bigint,minimum_price_kobo=(p_data->>'minimum_price_kobo')::bigint,
   reorder_level=(p_data->>'reorder_level')::integer,supplier_id=nullif(p_data->>'supplier_id','') where company_id=p_company and id=pid;
  result=jsonb_build_object('id',pid);
 else
  wid=p_data->>'warehouse_id';pid=p_data->>'product_id';
  if coalesce(p_data->>'delta','')!~'^-?[0-9]{1,7}$' or(p_data->>'delta')::integer=0 or abs((p_data->>'delta')::integer)>1000000
   or length(trim(coalesce(p_data->>'reason',''))) not between 5 and 500 then raise exception 'Invalid stock adjustment';end if;
  delta=(p_data->>'delta')::integer;
  perform 1 from products where company_id=p_company and id=pid and archived_at is null for update;
  if not found then raise exception 'Product unavailable';end if;
  insert into tenant_inventory(company_id,warehouse_id,product_id,on_hand) values(p_company,wid,pid,0) on conflict do nothing;
  update tenant_inventory set on_hand=on_hand+delta where company_id=p_company and warehouse_id=wid and product_id=pid and on_hand+delta>=reserved;
  if not found then raise exception 'Adjustment would consume reserved or unavailable stock';end if;
  insert into stock_movements(company_id,product_id,warehouse_id,quantity,reason,actor,command_id) values(p_company,pid,wid,delta,trim(p_data->>'reason'),auth.uid(),p_key);
  perform tenant_stock_sync(p_company,pid);
  result=jsonb_build_object('id',p_key,'on_hand',(select on_hand from tenant_inventory where company_id=p_company and warehouse_id=wid and product_id=pid));
 end if;
 insert into tenant_business_commands(company_id,id,actor,action,payload,result) values(p_company,p_key,auth.uid(),p_action,p_data,result);
 perform platform_log(p_company,'business.'||p_action,jsonb_build_object('command',p_key,'result',result));
 return result;
end $$;

create function public.tenant_business_snapshot(p_company uuid,p_branch uuid default null,p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare term text;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_page is null or p_page not between 1 and 100000 or p_query is null or length(p_query)>100 then raise exception 'Invalid filters';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_branch is not null and not exists(select 1 from tenant_branches b where b.company_id=p_company and b.id=p_branch and b.active and
  (tenant_permission(p_company,'locations.manage',b.id) or exists(select 1 from warehouses w where w.company_id=p_company and w.branch_id=b.id and(tenant_permission(p_company,'inventory.read',null,w.id) or tenant_permission(p_company,'orders.read',null,w.id))))) then raise exception 'Forbidden';end if;
 -- Treat search as literal text, not as user-supplied LIKE wildcard syntax.
 term=replace(replace(replace(lower(trim(p_query)),'\','\\'),'%','\%'),'_','\_');
 return jsonb_build_object(
  'company_id',p_company,'access',saas_access(p_company),'page',p_page,
  'permissions',(select coalesce(jsonb_agg(p),'[]') from unnest(array['catalogue.read','catalogue.edit','inventory.read','inventory.adjust','orders.read','orders.manage','procurement.manage','finance.read','finance.manage','reports.read','locations.manage','affiliates.read']) p where tenant_any_permission(p_company,p)),
  'can_manage_customers',tenant_permission(p_company,'orders.manage'),'can_manage_suppliers',tenant_permission(p_company,'procurement.manage'),'can_manage_master',tenant_permission(p_company,'catalogue.edit'),
  'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from tenant_branches b where b.company_id=p_company and b.active and(tenant_permission(p_company,'locations.manage',b.id) or exists(select 1 from warehouses w where w.company_id=p_company and w.branch_id=b.id and(tenant_permission(p_company,'inventory.read',null,w.id) or tenant_permission(p_company,'orders.read',null,w.id))))),'[]'),
  'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'branch_id',w.branch_id) order by w.name) from warehouses w where w.company_id=p_company and w.active and(p_branch is null or w.branch_id=p_branch) and tenant_permission(p_company,'inventory.read',null,w.id)),'[]'),
  'customers',coalesce((select jsonb_agg(to_jsonb(c)) from(select * from tenant_customers where company_id=p_company and tenant_permission(p_company,'orders.manage') and(lower(name) like '%'||term||'%' or lower(email) like '%'||term||'%' or phone like '%'||term||'%') order by lower(name),id limit 25 offset(p_page-1)*25)c),'[]'),
  'customer_count',(select count(*) from tenant_customers where company_id=p_company and tenant_permission(p_company,'orders.manage') and(lower(name) like '%'||term||'%' or lower(email) like '%'||term||'%' or phone like '%'||term||'%')),
  'suppliers',coalesce((select jsonb_agg(to_jsonb(s)) from(select id,name,email,phone,address,notes,active from suppliers where company_id=p_company and tenant_permission(p_company,'procurement.manage') and(lower(name) like '%'||term||'%' or lower(email) like '%'||term||'%') order by lower(name),id limit 25 offset(p_page-1)*25)s),'[]'),
  'supplier_count',(select count(*) from suppliers where company_id=p_company and tenant_permission(p_company,'procurement.manage') and(lower(name) like '%'||term||'%' or lower(email) like '%'||term||'%')),
  'supplier_choices',coalesce((select jsonb_agg(to_jsonb(s)) from(select id,name from suppliers where company_id=p_company and active and tenant_permission(p_company,'catalogue.edit') order by lower(name),id limit 100)s),'[]'),
  'products',coalesce((select jsonb_agg(to_jsonb(p)) from(select id,name,sku,barcode,cost_kobo,wholesale_kobo,minimum_price_kobo,reorder_level,supplier_id,price_kobo,active from products where company_id=p_company and tenant_permission(p_company,'catalogue.edit') and archived_at is null and(lower(name) like '%'||term||'%' or lower(sku) like '%'||term||'%' or lower(barcode) like '%'||term||'%') order by lower(name),id limit 25 offset(p_page-1)*25)p),'[]'),
  'product_count',(select count(*) from products where company_id=p_company and tenant_permission(p_company,'catalogue.edit') and archived_at is null and(lower(name) like '%'||term||'%' or lower(sku) like '%'||term||'%' or lower(barcode) like '%'||term||'%')),
  'inventory',coalesce((select jsonb_agg(to_jsonb(i)) from(select i.warehouse_id,i.product_id,p.name,p.sku,i.on_hand,i.reserved,i.on_hand-i.reserved available,p.reorder_level from tenant_inventory i join warehouses w on w.company_id=i.company_id and w.id=i.warehouse_id join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=p_company and tenant_permission(p_company,'inventory.read',null,i.warehouse_id) and(p_branch is null or w.branch_id=p_branch) and(lower(p.name) like '%'||term||'%' or lower(p.sku) like '%'||term||'%') order by p.name,i.warehouse_id,p.id limit 25 offset(p_page-1)*25)i),'[]'),
  'inventory_count',(select count(*) from tenant_inventory i join warehouses w on w.company_id=i.company_id and w.id=i.warehouse_id join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=p_company and tenant_permission(p_company,'inventory.read',null,i.warehouse_id) and(p_branch is null or w.branch_id=p_branch) and(lower(p.name) like '%'||term||'%' or lower(p.sku) like '%'||term||'%')),
  'movements',coalesce((select jsonb_agg(to_jsonb(m)) from(select m.id,m.product_id,p.name,m.warehouse_id,m.quantity,m.movement_kind,m.reason,m.actor,m.command_id,m.created_at from stock_movements m join warehouses w on w.company_id=m.company_id and w.id=m.warehouse_id join products p on p.company_id=m.company_id and p.id=m.product_id where m.company_id=p_company and tenant_permission(p_company,'inventory.read',null,m.warehouse_id) and(p_branch is null or w.branch_id=p_branch) and(lower(p.name) like '%'||term||'%' or lower(p.sku) like '%'||term||'%') order by m.created_at desc,m.id limit 25 offset(p_page-1)*25)m),'[]'),
  'movement_count',(select count(*) from stock_movements m join warehouses w on w.company_id=m.company_id and w.id=m.warehouse_id join products p on p.company_id=m.company_id and p.id=m.product_id where m.company_id=p_company and tenant_permission(p_company,'inventory.read',null,m.warehouse_id) and(p_branch is null or w.branch_id=p_branch) and(lower(p.name) like '%'||term||'%' or lower(p.sku) like '%'||term||'%')),
  'attention',coalesce((select jsonb_agg(to_jsonb(i)) from(select i.warehouse_id,i.product_id,p.name,p.sku,i.on_hand,i.reserved,i.on_hand-i.reserved available,p.reorder_level from tenant_inventory i join warehouses w on w.company_id=i.company_id and w.id=i.warehouse_id join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=p_company and tenant_permission(p_company,'inventory.read',null,i.warehouse_id) and(p_branch is null or w.branch_id=p_branch) and i.on_hand-i.reserved<=p.reorder_level and(lower(p.name) like '%'||term||'%' or lower(p.sku) like '%'||term||'%') order by i.on_hand-i.reserved,p.name,i.warehouse_id,p.id limit 5)i),'[]'),
  'metrics',(select jsonb_build_object('on_hand',coalesce(sum(i.on_hand),0),'reserved',coalesce(sum(i.reserved),0),'available',coalesce(sum(i.on_hand-i.reserved),0),'low_stock',count(*) filter(where i.on_hand-i.reserved<=p.reorder_level)) from tenant_inventory i join products p on p.company_id=i.company_id and p.id=i.product_id join warehouses w on w.company_id=i.company_id and w.id=i.warehouse_id where i.company_id=p_company and tenant_permission(p_company,'inventory.read',null,i.warehouse_id) and(p_branch is null or w.branch_id=p_branch))
 );
end $$;
alter function tenant_business_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
alter function tenant_business_snapshot(uuid,uuid,text,integer) owner to edge_tenant_executor;
revoke all on function business_classify_movement(),business_immutable_evidence(),tenant_business_command(uuid,uuid,text,jsonb),tenant_business_snapshot(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function tenant_business_command(uuid,uuid,text,jsonb),tenant_business_snapshot(uuid,uuid,text,integer) to authenticated;
reset lock_timeout;
