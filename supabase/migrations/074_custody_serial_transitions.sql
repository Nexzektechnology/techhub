create or replace function tenant_serial_transition(p_company uuid,p_ids uuid[],p_previous text,p_next text,p_source_kind text,p_source_id text,p_note text,p_command uuid default null,p_links jsonb default '{}',p_warehouse text default null) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare unit_record tenant_serial_units;seen integer:=0;begin
 if p_ids is null or cardinality(p_ids) not between 1 and 10000 or(select count(distinct unnest_id) from unnest(p_ids) unnest_id)<>cardinality(p_ids) then raise exception 'Choose a distinct nonempty unit set';end if;
 if jsonb_typeof(p_links) is distinct from 'object' or length(p_note) not between 5 and 1000 then raise exception 'Record the tracked source evidence';end if;
 for unit_record in select * from tenant_serial_units where company_id=p_company and id=any(p_ids) order by id for update loop
  if unit_record.state<>p_previous then raise exception 'Serial state changed; review the source transaction';end if;
  update tenant_serial_units set state=p_next,warehouse_id=coalesce(p_warehouse,warehouse_id),
   release_id=case when p_links?'release_id' then(p_links->>'release_id')::uuid else release_id end,
   order_id=case when p_links?'order_id' then(p_links->>'order_id')::uuid else order_id end,
   order_item_id=case when p_links?'order_item_id' then(p_links->>'order_item_id')::uuid else order_item_id end,
   pos_sale_id=case when p_links?'pos_sale_id' then(p_links->>'pos_sale_id')::uuid else pos_sale_id end,
   pos_item_id=case when p_links?'pos_item_id' then(p_links->>'pos_item_id')::uuid else pos_item_id end,
   warranty_until=case when p_links?'warranty_until' then(p_links->>'warranty_until')::date else warranty_until end,
   condition=case when p_links?'condition' then p_links->>'condition' else condition end
  where company_id=p_company and id=unit_record.id;
  insert into tenant_serial_events(company_id,unit_id,command_id,source_kind,source_id,previous_state,next_state,previous_warehouse,next_warehouse,note,actor,metadata)
  values(p_company,unit_record.id,p_command,p_source_kind,p_source_id,p_previous,p_next,unit_record.warehouse_id,coalesce(p_warehouse,unit_record.warehouse_id),p_note,auth.uid(),jsonb_build_object('previous_links',jsonb_build_object('release_id',unit_record.release_id,'order_id',unit_record.order_id,'order_item_id',unit_record.order_item_id,'pos_sale_id',unit_record.pos_sale_id,'pos_item_id',unit_record.pos_item_id,'warranty_until',unit_record.warranty_until,'condition',unit_record.condition),'new_links',p_links));seen=seen+1;
 end loop;
 if seen<>cardinality(p_ids) then raise exception 'Serial unit unavailable';end if;
end $$;

create table tenant_serial_requested_links(company_id uuid not null,release_id uuid not null,unit_id uuid not null,primary key(company_id,release_id,unit_id),foreign key(company_id,release_id) references tenant_custody_releases(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id));
alter table tenant_serial_requested_links enable row level security;
revoke all on tenant_serial_requested_links from public,anon,authenticated;
create policy tenant_company_boundary on tenant_serial_requested_links as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy tenant_executor_access on tenant_serial_requested_links for all to edge_tenant_executor using(true) with check(true);
grant select,insert on tenant_serial_requested_links to edge_tenant_executor;
create trigger immutable_serial_request before update or delete on tenant_serial_requested_links for each row execute function business_immutable_evidence();

alter function tenant_affiliate_command(uuid,uuid,text,jsonb) rename to tenant_affiliate_command_before_serials;
revoke all on function tenant_affiliate_command_before_serials(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function tenant_affiliate_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare rel tenant_custody_releases;result jsonb;chosen uuid[];approved_ids jsonb;qty integer;declaration_data jsonb;links jsonb:='{}';next_state text;warranty_days integer;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 if not tenant_verified_user() or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;perform set_config('app.tenant_id',p_company::text,true);
 if p_action='request' and tenant_serial_enabled(p_company,p_data->>'product_id') then
  if(p_data->>'quantity')::integer>200 then raise exception 'Use approved batches of up to 200 identified units per release';end if;
  result=tenant_affiliate_command_before_serials(p_company,p_key,p_action,p_data);
  if exists(select 1 from tenant_serial_requested_links where company_id=p_company and release_id=p_key) then return result;end if;
  if p_data->'unit_ids' is null then raise exception 'Select every serial unit for the manager to review before approval';end if;
  perform 1 from products where company_id=p_company and id=p_data->>'product_id' for update;
  chosen=tenant_serial_select(p_company,p_data->>'product_id',p_data->>'warehouse_id',(p_data->>'quantity')::integer,null,p_data->'unit_ids');
  insert into tenant_serial_requested_links(company_id,release_id,unit_id) select p_company,p_key,id from unnest(chosen) id;return result;
 end if;
 if p_action not in ('release','sale','sale-declare','return-declare','inspect','loss','receive') then return tenant_affiliate_command_before_serials(p_company,p_key,p_action,p_data);end if;
 select * into rel from tenant_custody_releases where company_id=p_company and id=(p_data->>'release_id')::uuid for update;
 if not found then raise exception 'Release unavailable';end if;
 if not tenant_serial_enabled(p_company,rel.product_id) then return tenant_affiliate_command_before_serials(p_company,p_key,p_action,p_data);end if;
 if p_action in ('sale-declare','return-declare') and tenant_affiliate_self(p_company,rel.affiliate_id) then null;else perform tenant_assert(p_company,'affiliates.manage',null,rel.warehouse_id);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 if exists(select 1 from tenant_business_commands where company_id=p_company and id=p_key) then return tenant_affiliate_command_before_serials(p_company,p_key,p_action,p_data);end if;
 perform tenant_finance_ensure(p_company);perform 1 from products where company_id=p_company and id=rel.product_id for update;
 qty=case when p_action='release' then rel.quantity else(p_data->>'quantity')::integer end;
 if qty is null or qty not between 1 and 200 then raise exception 'Select or scan every identified unit for this custody transaction';end if;
 if p_action='release' then
  select jsonb_agg(unit_id::text order by unit_id) into approved_ids from tenant_serial_requested_links where company_id=p_company and release_id=rel.id;
  if approved_ids is null or jsonb_array_length(approved_ids)<>qty then raise exception 'Release lacks approved serial selection; cancel and submit an identified request';end if;
  if p_data->'unit_ids' is not null and exists(select 1 from jsonb_array_elements_text(p_data->'unit_ids') selected(value) where not approved_ids ? selected.value::uuid::text) then raise exception 'Handover must match the serial units reviewed by the approving manager';end if;
 elsif p_data->'unit_ids' is null then raise exception 'Select or scan every identified unit for this custody transaction';end if;
 chosen=tenant_serial_select(p_company,rel.product_id,rel.warehouse_id,qty,null,coalesce(p_data->'unit_ids',approved_ids),case when p_action='release' then 'available' when rel.relationship='interbranch' then 'transit' else 'custody' end,case when p_action='release' then null else rel.id end);
 if p_action in ('sale-declare','return-declare') and p_data->>'declaration_id' is not null then raise exception 'A new declaration cannot reference an existing declaration';end if;
 if p_data->>'declaration_id' is not null then
  select e.data into declaration_data from tenant_custody_events e join tenant_custody_declarations d on d.company_id=e.company_id and d.id=e.id where e.company_id=p_company and e.id=(p_data->>'declaration_id')::uuid and d.release_id=rel.id and d.processed<d.quantity;
  if not found or jsonb_typeof(declaration_data->'unit_ids') is distinct from 'array' then raise exception 'Identified declaration unavailable';end if;
  if exists(select 1 from unnest(chosen) chosen_units(id) where not exists(select 1 from jsonb_array_elements_text(declaration_data->'unit_ids') declared(value) where declared.value::uuid=chosen_units.id)) then raise exception 'Inspect or verify the serial units in the selected declaration';end if;
 elsif p_action<>'release' and exists(select 1 from tenant_custody_declarations d join tenant_custody_events e on e.company_id=d.company_id and e.id=d.id where d.company_id=p_company and d.release_id=rel.id and d.processed<d.quantity and exists(select 1 from jsonb_array_elements_text(coalesce(e.data->'unit_ids','[]')) declared(value) where case when declared.value~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then declared.value::uuid else null end=any(chosen))) then raise exception 'These units are covered by a pending declaration; verify or reject that declaration first';end if;
 result=tenant_affiliate_command_before_serials(p_company,p_key,p_action,p_data);
 if p_action in ('sale-declare','return-declare') then return result;end if;
 if p_action='release' then
  insert into tenant_serial_release_links(company_id,release_id,unit_id) select p_company,rel.id,id from unnest(chosen) id;
  links=jsonb_build_object('release_id',rel.id,'order_id',null,'order_item_id',null,'pos_sale_id',null,'pos_item_id',null);next_state=case when rel.relationship='interbranch' then 'transit' else 'custody' end;
  if rel.relationship='wholesale_credit' then select t.warranty_days into warranty_days from tenant_tracking_products t where t.company_id=p_company and t.product_id=rel.product_id;links=links||jsonb_build_object('warranty_until',case when coalesce(warranty_days,0)>0 then today+warranty_days else null end);end if;
 elsif p_action='sale' then
  next_state='sold';if rel.relationship<>'wholesale_credit' then select t.warranty_days into warranty_days from tenant_tracking_products t where t.company_id=p_company and t.product_id=rel.product_id;links=jsonb_build_object('warranty_until',case when coalesce(warranty_days,0)>0 then today+warranty_days else null end);end if;
 elsif p_action='inspect' then
  next_state=case when p_data->>'disposition'='resellable' then 'available' else 'damaged' end;links=jsonb_build_object('condition',case when p_data->>'disposition'='resellable' then 'used' else 'damaged' end);
 elsif p_action='loss' then next_state='missing';else next_state='available';end if;
 perform tenant_serial_transition(p_company,chosen,case when p_action='release' then 'available' when rel.relationship='interbranch' then 'transit' else 'custody' end,next_state,'affiliate.'||p_action,p_key::text,case when p_action='release' then 'Confirmed physical handover of identified custody units' else p_data->>'note' end,p_key,links,case when p_action='receive' then rel.destination_warehouse else null end);
 return result;
end $$;
alter function tenant_affiliate_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_affiliate_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_affiliate_command(uuid,uuid,text,jsonb) to authenticated;

alter function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) rename to tenant_affiliate_snapshot_before_serials;
revoke all on function tenant_affiliate_snapshot_before_serials(uuid,uuid,uuid,integer) from public,anon,authenticated;
create function tenant_affiliate_snapshot(p_company uuid,p_affiliate uuid default null,p_release uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb;releases jsonb;products jsonb;begin
 snapshot=tenant_affiliate_snapshot_before_serials(p_company,p_affiliate,p_release,p_page);perform set_config('app.tenant_id',p_company::text,true);
 select coalesce(jsonb_agg(r||jsonb_build_object('tracking_mode',case when tenant_serial_enabled(p_company,r->>'product_id') then 'serial' else 'none' end,'units',case when p_release is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(t)) from(
  select u.id,u.serial,u.imei,u.options,case when r->>'status' in ('cancelled','rejected') then 'not released' when r->>'status' in ('requested','approved') or u.release_id=(r->>'id')::uuid then u.state else 'returned' end state from tenant_serial_units u where u.company_id=p_company and u.product_id=r->>'product_id' and(
   (r->>'status' in ('requested','approved','cancelled','rejected') and exists(select 1 from tenant_serial_requested_links l where l.company_id=u.company_id and l.release_id=(r->>'id')::uuid and l.unit_id=u.id)) or
   (r->>'status' in ('released','closed') and exists(select 1 from tenant_serial_release_links l where l.company_id=u.company_id and l.release_id=(r->>'id')::uuid and l.unit_id=u.id))) order by u.serial,u.imei,u.id limit 200)t),'[]') end)),'[]') into releases from jsonb_array_elements(snapshot->'releases')r;
 select coalesce(jsonb_agg(p||jsonb_build_object('tracking_mode',case when tenant_serial_enabled(p_company,p->>'id') then 'serial' else 'none' end)),'[]') into products from jsonb_array_elements(snapshot->'products')p;
 return snapshot||jsonb_build_object('releases',releases,'products',products);
end $$;
alter function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) owner to edge_tenant_executor;
revoke all on function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) to authenticated;
