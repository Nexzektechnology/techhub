alter table stock_reservations add column warehouse_id text;
alter table stock_reservations add constraint tenant_reservation_warehouse foreign key(company_id,warehouse_id) references warehouses(company_id,id);
alter table orders add column settlement_subaccount text check(settlement_subaccount~'^ACCT_[A-Za-z0-9]+$');
alter table orders add constraint tenant_order_location_required check(company_id='10000000-0000-4000-8000-000000000001' or(branch_id is not null and warehouse_id is not null and settlement_subaccount is not null));
alter table payments add column provider_id text;
create unique index tenant_payment_provider_identity on payments(provider_id) where provider_id is not null;
create table public.tenant_payment_accounts(company_id uuid primary key references platform_companies(id),subaccount_code text not null unique check(subaccount_code~'^ACCT_[A-Za-z0-9]+$'),business_name text not null,verified_by uuid not null references profiles(id),verified_at timestamptz not null default now());
alter table tenant_payment_accounts enable row level security;
revoke all on tenant_payment_accounts from public,anon,authenticated;
create function public.tenant_commerce_enabled(p_company uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from platform_modules m join platform_companies c on c.id=m.company_id where m.company_id=p_company and m.module='commerce' and m.enabled and c.active)
$$;
create function public.tenant_link_payment_account(p_company uuid,p_code text,p_name text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 if not exists(select 1 from platform_companies where id=p_company and lower(trim(name))=lower(trim(p_name))) then raise exception 'Provider business name does not match the registered company';end if;
 insert into tenant_payment_accounts(company_id,subaccount_code,business_name,verified_by) values(p_company,p_code,p_name,auth.uid()) on conflict(company_id) do update set subaccount_code=excluded.subaccount_code,business_name=excluded.business_name,verified_by=auth.uid(),verified_at=now();
 perform platform_log(p_company,'tenant.payment_account.verified',jsonb_build_object('subaccount',p_code));
end $$;
create function public.tenant_payment_account_ready(p_company uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from tenant_payment_accounts where company_id=p_company) $$;
create function public.tenant_settlement_subaccount(p_company uuid) returns text language sql stable security definer set search_path=public as $$ select subaccount_code from tenant_payment_accounts where company_id=p_company $$;
revoke all on function tenant_settlement_subaccount(uuid) from public,anon,authenticated;
create function public.tenant_payment_company(p_reference text) returns uuid language sql stable security definer set search_path=public as $$ select company_id from orders where reference=p_reference and reference~'^edge-tenant-[0-9a-f-]{36}$' and company_id<>'10000000-0000-4000-8000-000000000001' $$;
create function public.tenant_public_company(p_slug text) returns table(id uuid,slug text,name text,brand jsonb) language sql stable security definer set search_path=public as $$ select id,slug,name,brand from platform_companies where slug=p_slug and active and tenant_commerce_enabled(id) $$;
create policy tenant_executor_company_read on platform_companies for select to edge_tenant_executor using(id=nullif(current_setting('app.tenant_id',true),'')::uuid and saas_member_role(id) is not null);
create policy tenant_executor_member_read on platform_memberships for select to edge_tenant_executor using(company_id=nullif(current_setting('app.tenant_id',true),'')::uuid and(user_id=auth.uid() or tenant_permission(company_id,'team.manage')));
create function public.tenant_payment_context(p_reference text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('company_id',o.company_id,'amount',o.total_kobo,'currency','NGN','subaccount',o.settlement_subaccount,'email',o.address->>'email') from orders o where o.reference=p_reference and o.reference~'^edge-tenant-[0-9a-f-]{36}$'
$$;
create or replace function public.tenant_assert(p_company uuid,p_permission text,p_branch uuid default null,p_warehouse text default null) returns void language plpgsql security invoker set search_path=public as $$ begin
 if not tenant_permission(p_company,p_permission,p_branch,p_warehouse) or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if not saas_can_write(p_company) then raise exception 'Subscription is read-only';end if;
 if p_company='10000000-0000-4000-8000-000000000001' then raise exception 'Use the existing flagship operations workspace';end if;
end $$;

create function public.tenant_expire_orders(p_company uuid) returns integer language plpgsql security invoker set search_path=public as $$ declare o orders;r stock_reservations;n integer:=0;begin
 for o in select * from orders where company_id=p_company and status='awaiting_payment' and expires_at<=now() order by id limit 200 for update loop
  for r in select * from stock_reservations where company_id=p_company and order_id=o.id and status='active' order by product_id loop
   perform 1 from products where company_id=p_company and id=r.product_id for update;
   update tenant_inventory set reserved=reserved-r.quantity where company_id=p_company and warehouse_id=r.warehouse_id and product_id=r.product_id;
   perform tenant_stock_sync(p_company,r.product_id);
   insert into stock_movements(company_id,product_id,warehouse_id,order_id,quantity,reason) values(p_company,r.product_id,r.warehouse_id,o.id,r.quantity,'Reservation expired');
  end loop;
  update stock_reservations set status='released' where company_id=p_company and order_id=o.id;
  update orders set status='expired' where company_id=p_company and id=o.id;n=n+1;
 end loop;return n;
end $$;
create function public.tenant_storefront(p_slug text,p_query text default '',p_page integer default 1,p_product text default null) returns jsonb language plpgsql stable security definer set search_path=public set app.tenant_id='' as $$
declare cid uuid;s tenant_storefronts;c platform_companies;begin
 select x.id,x.slug,x.name,x.brand into c.id,c.slug,c.name,c.brand from tenant_public_company(p_slug) x;
 if not found or not tenant_commerce_enabled(c.id) then raise exception 'Store unavailable';end if;cid=c.id;
 perform set_config('app.tenant_id',cid::text,true);
 select * into s from tenant_storefronts where company_id=cid and published;
 if not found or not exists(select 1 from warehouses w join tenant_branches b on b.company_id=w.company_id and b.id=w.branch_id where w.company_id=cid and w.id=s.warehouse_id and w.active and b.active) then raise exception 'Store unavailable';end if;
 if p_page is null or p_page not between 1 and 100000 or length(coalesce(p_query,''))>120 then raise exception 'Invalid catalogue search';end if;
 return jsonb_build_object('company',jsonb_build_object('id',cid,'slug',c.slug,'name',c.name,'brand',c.brand),'delivery_kobo',s.delivery_kobo,'checkout_ready',saas_can_write(cid) and tenant_payment_account_ready(cid),
 'count',(select count(*) from products where company_id=cid and active and archived_at is null and(p_query='' or position(lower(p_query) in lower(name||' '||brand))>0) and(p_product is null or tenant_slug=p_product)),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.tenant_slug,'name',p.name,'category_id',p.category_id,'brand',coalesce(nullif(p.brand,''),p.merchant_name),'merchant_id',p.merchant_id,'merchant_name',c.name,'price_kobo',p.price_kobo,'previous_price_kobo',p.previous_price_kobo,'stock',coalesce(i.on_hand,0),'reserved',coalesce(i.reserved,0),'image',p.image,'images',p.images,'description',coalesce(nullif(p.description,''),p.name),'options',p.options,'active',p.active,'featured',p.featured,'created_at',p.created_at)) from(select * from products where company_id=cid and active and archived_at is null and(p_query='' or position(lower(p_query) in lower(name||' '||brand))>0) and(p_product is null or tenant_slug=p_product) order by created_at desc,id limit 12 offset(p_page-1)*12)p left join tenant_inventory i on i.company_id=cid and i.product_id=p.id and i.warehouse_id=s.warehouse_id),'[]'));
end $$;
create function public.tenant_checkout(p_slug text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public set app.tenant_id='' as $$
declare c platform_companies;s tenant_storefronts;w warehouses;k uuid:=(p_input->>'key')::uuid;fp text:=md5(p_input::text);prior idempotency_records;oid uuid:=gen_random_uuid();ref text:='edge-tenant-'||gen_random_uuid()::text;p products;line jsonb;pair record;opt record;qty integer;available integer;subtotal bigint:=0;begin
 if not tenant_verified_user() then raise exception 'Authentication required';end if;
 select x.id,x.slug,x.name,x.brand into c.id,c.slug,c.name,c.brand from tenant_public_company(p_slug) x;
 if not found or not tenant_commerce_enabled(c.id) or not saas_can_write(c.id) or not tenant_payment_account_ready(c.id) then raise exception 'Checkout unavailable';end if;
 perform set_config('app.tenant_id',c.id::text,true);
 select * into s from tenant_storefronts where company_id=c.id and published;if not found then raise exception 'Checkout unavailable';end if;
 select * into w from warehouses where company_id=c.id and id=s.warehouse_id and active;if not found or not exists(select 1 from tenant_branches where company_id=c.id and id=w.branch_id and active) then raise exception 'Checkout unavailable';end if;
 if k is null or jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') not between 1 and 50 or coalesce(length(p_input->'address'->>'name'),0) not between 2 and 100 or coalesce(length(p_input->'address'->>'street'),0) not between 5 and 250 or coalesce(p_input->'address'->>'email','')!~'^[^@ ]+@[^@ ]+\.[^@ ]+$' or octet_length(p_input::text)>20000 then raise exception 'Invalid checkout';end if;
 if coalesce(p_input->>'coupon','')<>'' then raise exception 'Coupon unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('tenant-checkout:'||k::text,0));
 select * into prior from idempotency_records where company_id=c.id and key=k;
 if found then if prior.owner_id<>auth.uid() or prior.fingerprint<>fp then raise exception 'Checkout retry key already used';end if;return tenant_order_json(c.id,prior.order_id);end if;
 perform tenant_expire_orders(c.id);
 for pair in select value->>'product_id' product_id,sum((value->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_input->'items') group by 1 order by 1 loop
  select * into p from products where company_id=c.id and id=pair.product_id and active and archived_at is null for update;if not found then raise exception 'Product unavailable';end if;
  select on_hand-reserved into available from tenant_inventory where company_id=c.id and warehouse_id=w.id and product_id=p.id for update;
  if pair.quantity not between 1 and 2500 or coalesce(available,0)<pair.quantity then raise exception 'Insufficient stock';end if;
 end loop;
 for line in select value from jsonb_array_elements(p_input->'items') loop
  select * into p from products where company_id=c.id and id=line->>'product_id';qty=(line->>'quantity')::integer;
  if qty is null or qty not between 1 and 50 or jsonb_typeof(coalesce(line->'options','{}')) is distinct from 'object' then raise exception 'Invalid cart line';end if;
  if line ? 'expected_price_kobo' and (line->>'expected_price_kobo')::bigint is distinct from p.price_kobo then raise exception 'Prices changed; refresh your bag';end if;
  for opt in select * from jsonb_each(p.options) loop if not opt.value ? coalesce(line->'options'->>opt.key,'') then raise exception 'Choose valid product options';end if;end loop;
  for opt in select * from jsonb_each(coalesce(line->'options','{}')) loop if not p.options ? opt.key then raise exception 'Invalid product option';end if;end loop;
  subtotal=subtotal+p.price_kobo*qty;
 end loop;
 insert into orders(company_id,id,customer_id,branch_id,warehouse_id,settlement_subaccount,address,subtotal_kobo,delivery_kobo,discount_kobo,total_kobo,reference,expires_at) values(c.id,oid,auth.uid(),w.branch_id,w.id,tenant_settlement_subaccount(c.id),p_input->'address',subtotal,s.delivery_kobo,0,subtotal+s.delivery_kobo,ref,now()+interval '30 minutes');
 for line in select value from jsonb_array_elements(p_input->'items') loop
  select * into p from products where company_id=c.id and id=line->>'product_id';
  insert into order_items(company_id,order_id,product_id,name,quantity,price_kobo,merchant_id,options) values(c.id,oid,p.id,p.name,(line->>'quantity')::integer,p.price_kobo,p.merchant_id,coalesce(line->'options','{}'));
 end loop;
 insert into order_allocations(company_id,order_id,merchant_id,total_kobo) select c.id,oid,merchant_id,sum(quantity*price_kobo) from order_items where company_id=c.id and order_id=oid group by merchant_id;
 insert into stock_reservations(company_id,order_id,product_id,warehouse_id,quantity,status) select c.id,oid,product_id,w.id,sum(quantity),'active' from order_items where company_id=c.id and order_id=oid group by product_id;
 for pair in select product_id,quantity from stock_reservations where company_id=c.id and order_id=oid order by product_id loop
  update tenant_inventory set reserved=reserved+pair.quantity where company_id=c.id and warehouse_id=w.id and product_id=pair.product_id;perform tenant_stock_sync(c.id,pair.product_id);
 end loop;
 insert into idempotency_records(company_id,key,owner_id,fingerprint,order_id) values(c.id,k,auth.uid(),fp,oid);
 perform platform_log(c.id,'tenant.order.created',jsonb_build_object('order',oid));return tenant_order_json(c.id,oid);
end $$;
create function public.tenant_my_order(p_slug text,p_reference text) returns jsonb language plpgsql stable security definer set search_path=public set app.tenant_id='' as $$ declare cid uuid;o orders;begin
 select id into cid from tenant_public_company(p_slug);if not found or not tenant_verified_user() then raise exception 'Authentication required';end if;
 perform set_config('app.tenant_id',cid::text,true);select * into o from orders where company_id=cid and reference=p_reference;
 if not found or(o.customer_id<>auth.uid() and not tenant_permission(cid,'orders.read',null,o.warehouse_id)) then raise exception 'Forbidden';end if;return tenant_order_json(cid,o.id);
end $$;
create function public.tenant_apply_payment(p_reference text,p_amount bigint,p_currency text,p_status text,p_provider text) returns jsonb language plpgsql security definer set search_path=public set app.tenant_id='' as $$ declare cid uuid;o orders;r stock_reservations;existing payments;begin
 cid=tenant_payment_company(p_reference);if cid is null then raise exception 'Unknown tenant payment';end if;perform set_config('app.tenant_id',cid::text,true);
 select * into o from orders where company_id=cid and reference=p_reference for update;
 if p_amount is distinct from o.total_kobo or p_currency is distinct from 'NGN' or p_status is distinct from 'success' or coalesce(p_provider,'')!~'^[0-9]{1,30}$' then raise exception 'Payment verification mismatch';end if;
 select * into existing from payments where company_id=cid and reference=p_reference;
 if found then if existing.provider_id is distinct from p_provider then raise exception 'Provider transaction mismatch';end if;return tenant_order_json(cid,o.id);end if;
 if o.status<>'awaiting_payment' or o.expires_at<=now() then raise exception 'Expired payment requires reconciliation';end if;
 for r in select * from stock_reservations where company_id=cid and order_id=o.id and status='active' order by product_id loop
  perform 1 from products where company_id=cid and id=r.product_id for update;
  update tenant_inventory set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity where company_id=cid and warehouse_id=r.warehouse_id and product_id=r.product_id;
  perform tenant_stock_sync(cid,r.product_id);
  insert into stock_movements(company_id,product_id,warehouse_id,order_id,quantity,reason) values(cid,r.product_id,r.warehouse_id,o.id,-r.quantity,'Verified paid sale');
 end loop;
 update stock_reservations set status='consumed' where company_id=cid and order_id=o.id;
 update orders set payment_status='paid',status='processing' where company_id=cid and id=o.id;
 update order_allocations set status='processing' where company_id=cid and order_id=o.id;
 insert into payments(company_id,reference,amount_kobo,currency,status,provider_id) values(cid,p_reference,p_amount,p_currency,p_status,p_provider);
 insert into payment_webhooks(company_id,reference) values(cid,p_reference);
 insert into merchant_ledger(company_id,order_id,merchant_id,gross_kobo,discount_kobo,commission_kobo,net_kobo) select cid,o.id,merchant_id,total_kobo,0,0,total_kobo from order_allocations where company_id=cid and order_id=o.id;
 perform platform_log(cid,'tenant.payment.verified',jsonb_build_object('reference',p_reference));return tenant_order_json(cid,o.id);
end $$;
create function public.tenant_expire_company(p_company uuid) returns integer language plpgsql security definer set search_path=public set app.tenant_id='' as $$ begin perform set_config('app.tenant_id',p_company::text,true);return tenant_expire_orders(p_company);end $$;
create function public.tenant_expire_pending() returns integer language plpgsql security definer set search_path=public as $$ declare cid uuid;n integer:=0;begin
 for cid in select distinct company_id from orders where company_id<>'10000000-0000-4000-8000-000000000001' and status='awaiting_payment' and expires_at<=now() limit 100 loop n=n+tenant_expire_company(cid);end loop;return n;
end $$;

do $$ declare signature text;begin foreach signature in array array['tenant_storefront(text,text,integer,text)','tenant_checkout(text,jsonb)','tenant_my_order(text,text)','tenant_apply_payment(text,bigint,text,text,text)','tenant_expire_company(uuid)'] loop execute 'alter function public.'||signature||' owner to edge_tenant_executor';end loop;end $$;
grant select,insert,update,delete on tenant_payment_accounts to edge_tenant_executor;
revoke all on function tenant_commerce_enabled(uuid),tenant_link_payment_account(uuid,text,text),tenant_payment_account_ready(uuid),tenant_payment_company(text),tenant_payment_context(text),tenant_expire_orders(uuid),tenant_storefront(text,text,integer,text),tenant_checkout(text,jsonb),tenant_my_order(text,text),tenant_apply_payment(text,bigint,text,text,text),tenant_expire_company(uuid),tenant_expire_pending() from public,anon,authenticated;
revoke all on function tenant_public_company(text) from public,anon,authenticated;
grant execute on function tenant_storefront(text,text,integer,text) to anon,authenticated;
grant execute on function tenant_checkout(text,jsonb),tenant_my_order(text,text),tenant_link_payment_account(uuid,text,text) to authenticated;
grant execute on function tenant_apply_payment(text,bigint,text,text,text),tenant_payment_context(text),tenant_expire_pending() to service_role;
grant execute on all functions in schema public to edge_legacy_executor,edge_tenant_executor;
-- Provisioning becomes configurable after the isolated commerce entrypoints exist.
do $$ declare r record;begin for r in select conname from pg_constraint where conrelid='platform_modules'::regclass and contype='c' and pg_get_constraintdef(oid) like '%enabled%' loop execute format('alter table platform_modules drop constraint %I',r.conname);end loop;end $$;
alter table platform_modules add constraint provisioned_module_only check(not enabled or module in ('branding','field_operations','commerce'));
update saas_module_registry set ready=true,description='Company-scoped catalogue, warehouse inventory and verified order payments' where id='commerce';
