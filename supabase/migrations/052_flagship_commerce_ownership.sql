-- Owner confirmed on 16 November 2026: ALL existing commerce belongs to E-Edge.
-- This is a compatibility/ownership baseline, NOT a commerce tenant cutover.
-- Keep new-company commerce disabled until every query, RPC, policy and UI is ported.
-- PostgreSQL's constant defaults preserve old INSERT signatures and existing IDs.
set local lock_timeout='5s';
set local statement_timeout='120s';

-- The timed-deal view used products' composite row type. PostgreSQL refuses
-- adding columns while a view depends on that whole row type. Keep the view's
-- existing interface, owner, grants and security-invoker mode, and express each
-- output column directly before adding the tenant key. No DROP/CASCADE is used.
do $$ declare projection text;begin
 select string_agg(case a.attname
  when 'price_kobo' then 'coalesce(public.effective_product_price(p.id),p.price_kobo)'
  when 'previous_price_kobo' then 'case when public.effective_product_price(p.id)<p.price_kobo then p.price_kobo else p.previous_price_kobo end'
  when 'regular_price_kobo' then 'p.price_kobo'
  else format('p.%I',a.attname)
 end||format(' as %I',a.attname),',' order by a.attnum) into projection
 from pg_attribute a where a.attrelid='public.storefront_products'::regclass and a.attnum>0 and not a.attisdropped;
 if projection is null then raise exception 'Storefront view unavailable; no ownership changes applied';end if;
 -- A non-materialized CTE preserves the original view's read-only contract
 -- while allowing predicate pushdown into the explicit product projection.
 execute 'create or replace view public.storefront_products with(security_invoker=true) as with storefront_projection as not materialized (select '||projection||' from public.products p) select * from storefront_projection';
end $$;
do $$
declare
 owned text[]:=array[
  'addresses','admin_record_trash','audit_logs','branding_assets','brands',
  'business_access','business_principals','business_product_principals','business_research','business_stock_requests','business_van_movements','business_van_sales','business_van_stock',
  'catalogue_external_sources','categories','content_pages','coupons','custom_commerce_assignments','custom_commerce_roles','customer_wishlist',
  'delivery_events','delivery_feedback','delivery_jobs','drivers','gallery_media','idempotency_records',
  'legacy_catalogue_source','legacy_customers','legacy_history_batches','legacy_history_records',
  'merchant_ledger','merchants','order_allocations','order_items','order_workflow_events','orders','organization_memberships','organizations',
  'payment_initializations','payment_webhooks','payments','pos_items','pos_receipts','pos_refunds','pos_reservations','pos_sales',
  'product_deals','products','purchase_orders','refunds','returns','reviews','settlements','stock_movements','stock_reservations',
  'subscriber_events','subscribers','suppliers','support_messages','support_tickets','theme_versions','warehouses','website_content','website_settings'
 ];
 t text;r record;child_columns text;parent_columns text;unique_name text;fk_name text;delete_action text;update_action text;
begin
 foreach t in array owned loop
  execute format('alter table public.%I add column company_id uuid not null default %L references public.platform_companies(id)',t,'10000000-0000-4000-8000-000000000001');
  execute format('alter table public.%I add constraint legacy_flagship_only check(company_id=%L::uuid)',t,'10000000-0000-4000-8000-000000000001');
  execute format('create index %I on public.%I(company_id)',t||'_company_idx',t);
  -- A restrictive policy prevents later permissive policies from accidentally
  -- opening unported commerce. Its removal requires a reviewed domain cutover.
  execute format('create policy legacy_company_boundary on public.%I as restrictive for all using(company_id=%L::uuid) with check(company_id=%L::uuid)',t,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
 end loop;
 -- Retain original foreign keys. Add company-aware keys without changing IDs,
 -- cascade semantics, unique slugs, grants, SECURITY DEFINER functions or view interfaces.
 for r in
  select c.*,ch.relname child_name,pa.relname parent_name
  from pg_constraint c join pg_class ch on ch.oid=c.conrelid join pg_class pa on pa.oid=c.confrelid
  where c.contype='f' and c.connamespace='public'::regnamespace and ch.relname=any(owned) and pa.relname=any(owned)
  and c.confdeltype in ('a','r','c') and c.confupdtype in ('a','r','c')
 loop
  select string_agg(quote_ident(a.attname),',' order by k.n) into child_columns
   from unnest(r.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.attnum;
  select string_agg(quote_ident(a.attname),',' order by k.n) into parent_columns
   from unnest(r.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=r.confrelid and a.attnum=k.attnum;
  unique_name='tenant_owner_uq_'||substr(md5(r.parent_name||':'||parent_columns),1,20);
  fk_name='tenant_owner_fk_'||substr(md5(r.child_name||':'||r.conname),1,20);
  execute format('create unique index if not exists %I on public.%I(company_id,%s)',unique_name,r.parent_name,parent_columns);
  delete_action=case r.confdeltype when 'c' then 'CASCADE' when 'r' then 'RESTRICT' else 'NO ACTION' end;
  update_action=case r.confupdtype when 'c' then 'CASCADE' when 'r' then 'RESTRICT' else 'NO ACTION' end;
  execute format('alter table public.%I add constraint %I foreign key(company_id,%s) references public.%I(company_id,%s) on delete %s on update %s not valid',r.child_name,fk_name,child_columns,r.parent_name,parent_columns,delete_action,update_action);
  execute format('alter table public.%I validate constraint %I',r.child_name,fk_name);
 end loop;
end $$;
-- Legacy outlets/principal assignments may reference flagship commerce only.
alter table field_stores add constraint legacy_outlet_company check(legacy_customer_id is null or company_id='10000000-0000-4000-8000-000000000001');
alter table company_staff_invitations add constraint legacy_principal_company check(principal_id is null or company_id='10000000-0000-4000-8000-000000000001');
-- Payouts already use company_id for staff and NULL for marketplace merchants.
-- Keep that compatibility contract; derive a non-null tenant key for both kinds.
alter table payout_requests add column tenant_id uuid generated always as(case when kind='merchant' then '10000000-0000-4000-8000-000000000001'::uuid else company_id end) stored;
alter table payout_requests add constraint payout_tenant_fk foreign key(tenant_id) references platform_companies(id);
alter table payout_requests add constraint payout_merchant_tenant_fk foreign key(tenant_id,merchant_id) references merchants(company_id,id);
create index payout_requests_tenant_idx on payout_requests(tenant_id,created_at desc);
reset lock_timeout;
reset statement_timeout;
