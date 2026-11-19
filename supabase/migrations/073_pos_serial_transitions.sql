create table tenant_serial_pos_sources(company_id uuid not null,item_id uuid not null,primary key(company_id,item_id),foreign key(company_id,item_id) references pos_items(company_id,id));
alter table tenant_serial_pos_links add column identified_on_return boolean not null default false;
alter table tenant_serial_pos_sources enable row level security;
revoke all on tenant_serial_pos_sources from public,anon,authenticated;
create policy tenant_company_boundary on tenant_serial_pos_sources as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy tenant_executor_access on tenant_serial_pos_sources for all to edge_tenant_executor using(true) with check(true);
grant select,insert on tenant_serial_pos_sources to edge_tenant_executor;
create trigger immutable_serial_pos_source before update or delete on tenant_serial_pos_sources for each row execute function business_immutable_evidence();

create or replace function tenant_serial_pos_receipt(p_company uuid,p_receipt jsonb) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select case when p_receipt is null then null else jsonb_set(p_receipt,'{items}',coalesce((select jsonb_agg(i||jsonb_build_object('serial_tracked',exists(select 1 from tenant_serial_pos_sources s where s.company_id=p_company and s.item_id=(i->>'id')::uuid),'serials',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'serial',u.serial,'imei',u.imei,'identified_on_return',l.identified_on_return) order by u.id) from tenant_serial_pos_links l join tenant_serial_units u on u.company_id=l.company_id and u.id=l.unit_id where l.company_id=p_company and l.item_id=(i->>'id')::uuid),'[]')) order by ord) from jsonb_array_elements(p_receipt->'items') with ordinality item(i,ord)),'[]')) end
$$;
alter function tenant_pos_sale_json(uuid,uuid) rename to tenant_pos_sale_json_before_serials;
revoke all on function tenant_pos_sale_json_before_serials(uuid,uuid) from public,anon,authenticated;
create function tenant_pos_sale_json(p_company uuid,p_sale uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select tenant_serial_pos_receipt(p_company,tenant_pos_sale_json_before_serials(p_company,p_sale))
$$;
alter function tenant_pos_sale_json(uuid,uuid) owner to edge_tenant_executor;
revoke all on function tenant_pos_sale_json(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_pos_sale_json(uuid,uuid) to edge_tenant_executor;

alter function tenant_pos_command(uuid,uuid,text,jsonb) rename to tenant_pos_command_before_serials;
revoke all on function tenant_pos_command_before_serials(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function tenant_pos_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare result jsonb;wid text;selected_sale_id uuid;source_item pos_items;line jsonb;unit_data jsonb;chosen uuid[];new_id uuid;prepared jsonb:='[]';selection jsonb;posted_item_id uuid;warranty_days integer;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_action not in ('sale','return') then
  result=tenant_pos_command_before_serials(p_company,p_key,p_action,p_data);return case when p_action='payment' then tenant_serial_pos_receipt(p_company,result) else result end;
 end if;
 if p_key is null or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 50 or octet_length(p_data::text)>24000 then raise exception 'Invalid tracked sale or return';end if;
 if p_action='sale' then wid=p_data->>'warehouse_id';perform tenant_assert(p_company,'orders.manage',null,wid);
 else
  selected_sale_id=(p_data->>'sale_id')::uuid;select warehouse_id into wid from pos_sales where company_id=p_company and id=selected_sale_id;
  if not found then raise exception 'Sale unavailable';end if;perform tenant_assert(p_company,'finance.manage',null,wid);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 if exists(select 1 from tenant_business_commands where company_id=p_company and id=p_key) then return tenant_serial_pos_receipt(p_company,tenant_pos_command_before_serials(p_company,p_key,p_action,p_data));end if;
 perform tenant_finance_ensure(p_company);
 -- Keep the session/product order used by the existing cashier implementation.
 perform 1 from tenant_cashier_sessions where company_id=p_company and id=(p_data->>'session_id')::uuid for update;
 if p_action='sale' then
  perform 1 from products where company_id=p_company and id in(select value->>'product_id' from jsonb_array_elements(p_data->'items')) order by id for update;
  if exists(select 1 from jsonb_array_elements(p_data->'items') l where tenant_serial_enabled(p_company,l->>'product_id') group by l->>'product_id',coalesce(l->'options','{}') having count(*)>1) then raise exception 'Combine duplicate tracked product variants into one cart line';end if;
  for line in select value from jsonb_array_elements(p_data->'items') loop
   if not tenant_serial_enabled(p_company,line->>'product_id') then
    if line->>'expected_tracking_mode'='serial' then raise exception 'Product tracking changed; review the cached sale';end if;continue;
   end if;
   if line->>'expected_tracking_mode' is distinct from 'serial' or line->'unit_ids' is null then raise exception 'Product requires identified serial units; review the cached sale and select or scan each unit';end if;
   if coalesce(line->>'quantity','')!~'^[0-9]{1,2}$' or(line->>'quantity')::integer not between 1 and 50 then raise exception 'Invalid tracked item quantity';end if;
   chosen=tenant_serial_select(p_company,line->>'product_id',wid,(line->>'quantity')::integer,coalesce(line->'options','{}'),line->'unit_ids');
   prepared=prepared||jsonb_build_array(jsonb_build_object('product_id',line->>'product_id','options',coalesce(line->'options','{}'),'ids',to_jsonb(chosen)));
  end loop;
 else
  perform 1 from pos_sales where company_id=p_company and id=selected_sale_id for update;
  perform 1 from products where company_id=p_company and id in(select i.product_id from pos_items i where i.company_id=p_company and i.sale_id=selected_sale_id and i.id in(select(value->>'item_id')::uuid from jsonb_array_elements(p_data->'items'))) order by id for update;
  for line in select value from jsonb_array_elements(p_data->'items') loop
   select * into source_item from pos_items where company_id=p_company and sale_id=selected_sale_id and id=(line->>'item_id')::uuid;
   if not found then raise exception 'Sale item unavailable';end if;
   if not tenant_serial_enabled(p_company,source_item.product_id) then continue;end if;
   if coalesce(line->>'quantity','')!~'^[0-9]{1,2}$' or(line->>'quantity')::integer not between 1 and 50 then raise exception 'Invalid tracked return quantity';end if;
   if exists(select 1 from tenant_serial_pos_sources where company_id=p_company and item_id=source_item.id) then
    if line->'unit_ids' is null then raise exception 'Select the original sold serial units for this inspected return';end if;
    chosen=tenant_serial_select(p_company,source_item.product_id,wid,(line->>'quantity')::integer,null,line->'unit_ids','sold');
    if exists(select 1 from unnest(chosen) chosen_units(id) where not exists(select 1 from tenant_serial_pos_links l where l.company_id=p_company and l.item_id=source_item.id and l.unit_id=chosen_units.id)) or exists(select 1 from tenant_serial_units u where u.company_id=p_company and u.id=any(chosen) and u.pos_item_id is distinct from source_item.id) then raise exception 'Returned serial unit belongs to another sale';end if;
   else
    -- Old sales never had an invented serial identity. A physical historical
    -- return must explicitly identify the newly inspected unit and its source.
    if jsonb_typeof(line->'new_units') is distinct from 'array' or jsonb_array_length(line->'new_units')<>(line->>'quantity')::integer then raise exception 'Scan each inspected unit from this historical sale';end if;chosen='{}';
    for unit_data in select value from jsonb_array_elements(line->'new_units') loop
     insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,imei,state,options,condition,source_reference,pos_sale_id,pos_item_id)
     values(p_company,source_item.product_id,wid,nullif(trim(unit_data->>'serial'),''),nullif(unit_data->>'imei',''),'sold',source_item.options,'used','historical-pos-return-'||p_key,selected_sale_id,source_item.id) returning id into new_id;
     insert into tenant_serial_pos_links(company_id,item_id,unit_id,identified_on_return) values(p_company,source_item.id,new_id,true);
     perform tenant_serial_event(p_company,new_id,null,null,'pos.historical-return',p_key::text,'Unit identified during physical inspection of a pre-tracking sale',p_key);chosen=array_append(chosen,new_id);
    end loop;
   end if;
   prepared=prepared||jsonb_build_array(jsonb_build_object('item_id',source_item.id,'disposition',line->>'disposition','ids',to_jsonb(chosen)));
  end loop;
 end if;
 result=tenant_pos_command_before_serials(p_company,p_key,p_action,p_data);
 for selection in select value from jsonb_array_elements(prepared) loop
  select array_agg(value::uuid) into chosen from jsonb_array_elements_text(selection->'ids');
  if p_action='sale' then
   select i.id into posted_item_id from pos_items i where i.company_id=p_company and i.sale_id=p_key and i.product_id=selection->>'product_id' and i.options=selection->'options';
   if posted_item_id is null then raise exception 'Tracked sale item unavailable';end if;
   insert into tenant_serial_pos_sources values(p_company,posted_item_id);insert into tenant_serial_pos_links(company_id,item_id,unit_id) select p_company,posted_item_id,id from unnest(chosen) id;
   select t.warranty_days into warranty_days from tenant_tracking_products t where t.company_id=p_company and t.product_id=selection->>'product_id';
   perform tenant_serial_transition(p_company,chosen,'available','sold','pos.sale',p_key::text,'Completed POS sale of identified units',p_key,jsonb_build_object('pos_sale_id',p_key,'pos_item_id',posted_item_id,'release_id',null,'order_id',null,'order_item_id',null,'warranty_until',case when coalesce(warranty_days,0)>0 then today+warranty_days else null end));
  else
   perform tenant_serial_transition(p_company,chosen,'sold',case when selection->>'disposition'='resellable' then 'available' else 'damaged' end,'pos.return',p_key::text,p_data->>'reason',p_key,jsonb_build_object('condition',case when selection->>'disposition'='resellable' then 'used' else 'damaged' end));
  end if;
 end loop;return tenant_serial_pos_receipt(p_company,result);
end $$;
alter function tenant_pos_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_pos_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_pos_command(uuid,uuid,text,jsonb) to authenticated;
