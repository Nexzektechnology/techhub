-- Immutable source links retain a unit's original receipts even after it is
-- returned and sold again. Current-custodian columns alone are not history.
alter table tenant_serial_units add column order_item_id uuid;
alter table tenant_serial_units add constraint tenant_serial_order_item foreign key(company_id,order_item_id) references order_items(company_id,id);
alter table tenant_serial_events add column metadata jsonb not null default '{}';
create table tenant_serial_pos_links(company_id uuid not null,item_id uuid not null,unit_id uuid not null,primary key(company_id,item_id,unit_id),foreign key(company_id,item_id) references pos_items(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id));
create table tenant_serial_order_links(company_id uuid not null,item_id uuid not null,unit_id uuid not null,primary key(company_id,item_id,unit_id),foreign key(company_id,item_id) references order_items(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id));
create table tenant_serial_release_links(company_id uuid not null,release_id uuid not null,unit_id uuid not null,primary key(company_id,release_id,unit_id),foreign key(company_id,release_id) references tenant_custody_releases(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id));
do $$ declare t text;begin
 foreach t in array array['tenant_serial_pos_links','tenant_serial_order_links','tenant_serial_release_links'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert on %I to edge_tenant_executor',t);
  execute format('create trigger immutable_serial_source before update or delete on %I for each row execute function business_immutable_evidence()',t);
 end loop;
end $$;

create function tenant_serial_enabled(p_company uuid,p_product text) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from tenant_tracking_products where company_id=p_company and product_id=p_product and mode='serial')
$$;

-- Caller locks the product first and verifies its own source permission. Passing
-- explicit identifiers requires an exact, distinct, in-scope set. Public online
-- checkout can allocate internally, with matching variant options, under lock.
create function tenant_serial_select(p_company uuid,p_product text,p_warehouse text,p_quantity integer,p_options jsonb default null,p_ids jsonb default null,p_state text default 'available',p_release uuid default null) returns uuid[] language plpgsql security invoker set search_path=public,pg_temp as $$
declare chosen uuid[]:='{}';unit_record record;begin
 if p_quantity is null or p_quantity not between 1 and 10000 or p_state not in ('available','custody','transit','sold','reserved','quarantine') then raise exception 'Invalid tracked unit selection';end if;
 if p_ids is not null then
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)<>p_quantity or(select count(distinct value) from jsonb_array_elements_text(p_ids))<>p_quantity then raise exception 'Select one distinct serial unit for each quantity';end if;
  if exists(select 1 from jsonb_array_elements_text(p_ids) v where v!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid serial unit identifier';end if;
 end if;
 for unit_record in select u.id from tenant_serial_units u where u.company_id=p_company and u.product_id=p_product and u.warehouse_id=p_warehouse and u.state=p_state and(p_options is null or u.options=p_options) and(p_ids is null or u.id in(select value::uuid from jsonb_array_elements_text(p_ids))) and(p_release is null or u.release_id=p_release) order by u.created_at,u.id limit p_quantity for update loop
  chosen=array_append(chosen,unit_record.id);
 end loop;
 if cardinality(chosen)<>p_quantity then raise exception 'Selected serial units are unavailable, reserved, in another location or do not match the source';end if;return chosen;
end $$;

create function tenant_serial_transition(p_company uuid,p_ids uuid[],p_previous text,p_next text,p_source_kind text,p_source_id text,p_note text,p_command uuid default null,p_links jsonb default '{}',p_warehouse text default null) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare unit_record tenant_serial_units;seen integer:=0;begin
 if p_ids is null or cardinality(p_ids) not between 1 and 10000 or(select count(distinct unnest_id) from unnest(p_ids) unnest_id)<>cardinality(p_ids) then raise exception 'Choose a distinct nonempty unit set';end if;
 if jsonb_typeof(p_links)<>'object' or length(p_note) not between 5 and 1000 then raise exception 'Record the tracked source evidence';end if;
 for unit_record in select * from tenant_serial_units where company_id=p_company and id=any(p_ids) order by id for update loop
  if unit_record.state<>p_previous then raise exception 'Serial state changed; review the source transaction';end if;
  update tenant_serial_units set state=p_next,warehouse_id=coalesce(p_warehouse,warehouse_id),
   release_id=case when p_links?'release_id' then(p_links->>'release_id')::uuid else release_id end,
   order_id=case when p_links?'order_id' then(p_links->>'order_id')::uuid else order_id end,
   order_item_id=case when p_links?'order_item_id' then(p_links->>'order_item_id')::uuid else order_item_id end,
   pos_sale_id=case when p_links?'pos_sale_id' then(p_links->>'pos_sale_id')::uuid else pos_sale_id end,
   pos_item_id=case when p_links?'pos_item_id' then(p_links->>'pos_item_id')::uuid else pos_item_id end,
   warranty_until=case when p_links?'warranty_until' then(p_links->>'warranty_until')::date else warranty_until end
  where company_id=p_company and id=unit_record.id;
  insert into tenant_serial_events(company_id,unit_id,command_id,source_kind,source_id,previous_state,next_state,previous_warehouse,next_warehouse,note,actor,metadata)
  values(p_company,unit_record.id,p_command,p_source_kind,p_source_id,p_previous,p_next,unit_record.warehouse_id,coalesce(p_warehouse,unit_record.warehouse_id),p_note,auth.uid(),jsonb_build_object('previous_links',jsonb_build_object('release_id',unit_record.release_id,'order_id',unit_record.order_id,'order_item_id',unit_record.order_item_id,'pos_sale_id',unit_record.pos_sale_id,'pos_item_id',unit_record.pos_item_id,'warranty_until',unit_record.warranty_until),'new_links',p_links));seen=seen+1;
 end loop;
 if seen<>cardinality(p_ids) then raise exception 'Serial unit unavailable';end if;
end $$;

create function tenant_serial_pos_receipt(p_company uuid,p_receipt jsonb) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select case when p_receipt is null then null else jsonb_set(p_receipt,'{items}',coalesce((select jsonb_agg(i||jsonb_build_object('serials',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'serial',u.serial,'imei',u.imei) order by u.id) from tenant_serial_pos_links l join tenant_serial_units u on u.company_id=l.company_id and u.id=l.unit_id where l.company_id=p_company and l.item_id=(i->>'id')::uuid),'[]')) order by ord) from jsonb_array_elements(p_receipt->'items') with ordinality item(i,ord)),'[]')) end
$$;
do $$ declare signature text;begin
 foreach signature in array array['tenant_serial_enabled(uuid,text)','tenant_serial_select(uuid,text,text,integer,jsonb,jsonb,text,uuid)','tenant_serial_transition(uuid,uuid[],text,text,text,text,text,uuid,jsonb,text)','tenant_serial_pos_receipt(uuid,jsonb)'] loop
  execute 'alter function '||signature||' owner to edge_tenant_executor';execute 'revoke all on function '||signature||' from public,anon,authenticated';execute 'grant execute on function '||signature||' to edge_tenant_executor';
 end loop;
end $$;
