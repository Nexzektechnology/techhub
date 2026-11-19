-- Private serial foundation. Activation is intentionally not exposed until all
-- stock-writing channels can commit unit transitions with their source records.
create table tenant_tracking_products(
 company_id uuid not null,product_id text not null,mode text not null default 'none' check(mode in ('none','serial')),
 safety_stock integer not null default 0 check(safety_stock between 0 and 1000000),maximum_stock integer check(maximum_stock between 0 and 1000000),lead_time_days integer not null default 7 check(lead_time_days between 0 and 365),warranty_days integer not null default 0 check(warranty_days between 0 and 3650),
 configured_by uuid references profiles,configured_at timestamptz not null default now(),primary key(company_id,product_id),foreign key(company_id,product_id) references products(company_id,id),check(maximum_stock is null or maximum_stock>=safety_stock)
);
create table tenant_serial_units(
 company_id uuid not null,id uuid not null default gen_random_uuid(),product_id text not null,warehouse_id text not null,
 serial text check(serial is null or(length(trim(serial)) between 1 and 100 and serial=trim(serial))),imei text check(imei is null or imei~'^[0-9]{15}$'),
 state text not null default 'available' check(state in ('available','reserved','custody','sold','quarantine','damaged','missing','transit','retired')),
 options jsonb not null default '{}' check(jsonb_typeof(options)='object'),bin text not null default '' check(length(bin)<=80),condition text not null default 'new' check(condition in ('new','used','refurbished','damaged')),
 supplier_id text,acquisition_cost_kobo bigint check(acquisition_cost_kobo between 0 and 1000000000),acquisition_date date,warranty_until date,source_reference text not null check(length(source_reference) between 6 and 160),
 release_id uuid,order_id uuid,pos_sale_id uuid,pos_item_id uuid,supersedes_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(company_id,id),foreign key(company_id,product_id) references products(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,supplier_id) references suppliers(company_id,id),foreign key(company_id,release_id) references tenant_custody_releases(company_id,id),foreign key(company_id,order_id) references orders(company_id,id),foreign key(company_id,pos_sale_id) references pos_sales(company_id,id),foreign key(company_id,pos_item_id) references pos_items(company_id,id),foreign key(company_id,supersedes_id) references tenant_serial_units(company_id,id),check(serial is not null or imei is not null)
);
create unique index tenant_serial_identity on tenant_serial_units(company_id,lower(serial)) where serial is not null;
create unique index tenant_imei_identity on tenant_serial_units(company_id,imei) where imei is not null;
create index tenant_serial_allocation on tenant_serial_units(company_id,product_id,warehouse_id,state,created_at,id);
create index tenant_serial_custodian on tenant_serial_units(company_id,release_id,state,id) where release_id is not null;
create index tenant_serial_order on tenant_serial_units(company_id,order_id,state,id) where order_id is not null;
create index tenant_serial_pos_item on tenant_serial_units(company_id,pos_item_id,state,id) where pos_item_id is not null;
create table tenant_serial_events(
 company_id uuid not null,id uuid not null default gen_random_uuid(),unit_id uuid not null,command_id uuid,source_kind text not null check(length(source_kind) between 2 and 80),source_id text not null check(length(source_id) between 1 and 160),
 previous_state text,next_state text not null,previous_warehouse text,next_warehouse text not null,note text not null check(length(note) between 5 and 1000),actor uuid references profiles,created_at timestamptz not null default now(),
 primary key(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id),foreign key(company_id,command_id) references tenant_business_commands(company_id,id) deferrable initially deferred,foreign key(company_id,previous_warehouse) references warehouses(company_id,id),foreign key(company_id,next_warehouse) references warehouses(company_id,id)
);
create index tenant_serial_history on tenant_serial_events(company_id,unit_id,created_at,id);
create table tenant_serial_totals(company_id uuid not null,product_id text not null,warehouse_id text not null,physical integer not null default 0,reserved integer not null default 0,primary key(company_id,product_id,warehouse_id),foreign key(company_id,product_id) references products(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),check(physical>=0 and reserved between 0 and physical));
do $$ declare t text;begin
 foreach t in array array['tenant_tracking_products','tenant_serial_units','tenant_serial_events'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert,update on %I to edge_tenant_executor',t);
 end loop;
end $$;
alter table tenant_serial_totals enable row level security;
revoke all on tenant_serial_totals from public,anon,authenticated,edge_tenant_executor;
create policy tenant_company_boundary on tenant_serial_totals as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy tenant_executor_access on tenant_serial_totals for select to edge_tenant_executor using(true);
grant select on tenant_serial_totals to edge_tenant_executor;
create trigger tenant_serial_event_immutable before update or delete on tenant_serial_events for each row execute function business_immutable_evidence();

create function tenant_serial_identity_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='DELETE' then raise exception 'Serial identities are permanent; retire or correct through a linked record';end if;
 if (old.company_id,old.id,old.product_id,old.serial,old.imei,old.created_at) is distinct from (new.company_id,new.id,new.product_id,new.serial,new.imei,new.created_at) then raise exception 'Serial identity is immutable; record an approved linked correction';end if;
 new.updated_at=now();return new;
end $$;
create trigger tenant_serial_identity_immutable before update or delete on tenant_serial_units for each row execute function tenant_serial_identity_guard();

-- Only this trusted row trigger writes the derived counters. Deferred checks
-- remain O(warehouses), even for a handover containing thousands of units.
create function tenant_serial_count_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if tg_op<>'INSERT' then
  update tenant_serial_totals set physical=physical-case when old.state in ('available','reserved') then 1 else 0 end,reserved=reserved-case when old.state='reserved' then 1 else 0 end where company_id=old.company_id and product_id=old.product_id and warehouse_id=old.warehouse_id;
 end if;
 if tg_op<>'DELETE' then
  insert into tenant_serial_totals(company_id,product_id,warehouse_id,physical,reserved) values(new.company_id,new.product_id,new.warehouse_id,case when new.state in ('available','reserved') then 1 else 0 end,case when new.state='reserved' then 1 else 0 end) on conflict(company_id,product_id,warehouse_id) do update set physical=tenant_serial_totals.physical+excluded.physical,reserved=tenant_serial_totals.reserved+excluded.reserved;
 end if;return null;
end $$;
create trigger tenant_serial_counts after insert or update or delete on tenant_serial_units for each row execute function tenant_serial_count_trigger();

-- Independent deferred validation catches any forgotten stock-writing path.
-- A unit in custody/quarantine/transit is never added to sellable availability.
create function tenant_serial_assert_balance(p_company uuid,p_product text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if not exists(select 1 from tenant_tracking_products where company_id=p_company and product_id=p_product and mode='serial') then return;end if;
 if exists(
  select 1 from (select warehouse_id,on_hand,reserved from tenant_inventory where company_id=p_company and product_id=p_product)i
  full join(select warehouse_id,physical,reserved from tenant_serial_totals where company_id=p_company and product_id=p_product)u using(warehouse_id)
  where coalesce(i.on_hand,0)<>coalesce(u.physical,0) or coalesce(i.reserved,0)<>coalesce(u.reserved,0)
 ) then raise exception 'Serial unit totals must match warehouse stock and reservations; use the tracked inventory workflow';end if;
end $$;
create function tenant_serial_balance_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if tg_op<>'INSERT' then perform tenant_serial_assert_balance(old.company_id,old.product_id);end if;
 if tg_op<>'DELETE' then perform tenant_serial_assert_balance(new.company_id,new.product_id);end if;return null;
end $$;
create constraint trigger tenant_serial_inventory_balanced after insert or update or delete on tenant_inventory deferrable initially deferred for each row execute function tenant_serial_balance_trigger();
create constraint trigger tenant_serial_units_balanced after insert or update or delete on tenant_serial_units deferrable initially deferred for each row execute function tenant_serial_balance_trigger();
create constraint trigger tenant_serial_mode_balanced after insert or update or delete on tenant_tracking_products deferrable initially deferred for each row execute function tenant_serial_balance_trigger();
revoke all on function tenant_serial_assert_balance(uuid,text),tenant_serial_balance_trigger(),tenant_serial_identity_guard(),tenant_serial_count_trigger() from public,anon,authenticated;
grant execute on function tenant_serial_assert_balance(uuid,text) to edge_tenant_executor;

-- A private transition helper records immutable source/actor evidence. Callers
-- still validate domain ownership, authorization, quantities and row locks.
create function tenant_serial_event(p_company uuid,p_unit uuid,p_previous text,p_previous_warehouse text,p_source_kind text,p_source_id text,p_note text,p_command uuid default null) returns void language sql security invoker set search_path=public,pg_temp as $$
 insert into tenant_serial_events(company_id,unit_id,command_id,source_kind,source_id,previous_state,next_state,previous_warehouse,next_warehouse,note,actor)
 select p_company,u.id,p_command,p_source_kind,p_source_id,p_previous,u.state,p_previous_warehouse,u.warehouse_id,p_note,auth.uid() from tenant_serial_units u where u.company_id=p_company and u.id=p_unit
$$;
alter function tenant_serial_event(uuid,uuid,text,text,text,text,text,uuid) owner to edge_tenant_executor;
revoke all on function tenant_serial_event(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function tenant_serial_event(uuid,uuid,text,text,text,text,text,uuid) to edge_tenant_executor;
