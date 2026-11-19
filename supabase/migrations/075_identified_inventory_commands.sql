-- Verified supporting purchase references are private evidence, distinct from
-- the recorded valuation journal. Updating a reference never invents a bill.
create table tenant_serial_cost_history(company_id uuid not null,id uuid not null default gen_random_uuid(),unit_id uuid not null,command_id uuid not null,previous_kobo bigint,new_kobo bigint,source_reference text not null,actor uuid not null references profiles,created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,unit_id) references tenant_serial_units(company_id,id),foreign key(company_id,command_id) references tenant_business_commands(company_id,id) deferrable initially deferred);
alter table tenant_serial_cost_history enable row level security;
revoke all on tenant_serial_cost_history from public,anon,authenticated;
create policy tenant_company_boundary on tenant_serial_cost_history as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy tenant_executor_access on tenant_serial_cost_history for all to edge_tenant_executor using(true) with check(true);
grant select,insert on tenant_serial_cost_history to edge_tenant_executor;
create trigger immutable_serial_cost_reference before update or delete on tenant_serial_cost_history for each row execute function business_immutable_evidence();

alter table tenant_business_commands drop constraint tenant_business_commands_action_check;
alter table tenant_business_commands add constraint tenant_business_commands_action_check check(action in ('customer','supplier','product-master','stock','pos.register','pos.open','pos.close','pos.sale','pos.payment','pos.return','pos.hold','pos.credit','pos.tax') or action~'^finance[.](setup|account|manual|reverse|period|expense|bill|pay|collect|bank-import|bank-match|bank-unmatch|transfer)$' or action~'^affiliate[.](register|request|approve|reject-request|cancel|release|acknowledge|sale|sale-declare|return-declare|declaration-reject|inspect|loss|remit|commission-pay|refund|receive)$' or action~'^inventory[.](configure|enroll|activate|receive|metadata|draft-retire|draft-location)$');

create function tenant_inventory_insert_units(p_company uuid,p_key uuid,p_product text,p_warehouse text,p_data jsonb,p_source text) returns uuid[] language plpgsql security invoker set search_path=public,pg_temp as $$
declare product_record products;unit_data jsonb;unit_options jsonb;option_record record;new_id uuid;identifiers uuid[]:='{}';purchase_cost bigint;reference text;begin
 select * into product_record from products where company_id=p_company and id=p_product;
 if not found or jsonb_typeof(p_data->'units') is distinct from 'array' or jsonb_array_length(p_data->'units') not between 1 and 200 then raise exception 'Provide 1 to 200 identified units';end if;
 reference=trim(coalesce(p_data->>'reference',''));if length(reference) not between 6 and 160 or p_data->'verified' is distinct from 'true'::jsonb or length(trim(coalesce(p_data->>'note',''))) not between 10 and 1000 then raise exception 'Verify the physical units and record supporting source evidence';end if;
 for unit_data in select value from jsonb_array_elements(p_data->'units') loop
  if jsonb_typeof(unit_data) is distinct from 'object' then raise exception 'Invalid identified unit';end if;
  if(unit_data?'serial' and jsonb_typeof(unit_data->'serial') is distinct from 'string') or(unit_data?'imei' and jsonb_typeof(unit_data->'imei') is distinct from 'string') then raise exception 'Serial and IMEI identifiers must be text';end if;
  unit_options=coalesce(unit_data->'options',p_data->'options','{}');if jsonb_typeof(unit_options) is distinct from 'object' then raise exception 'Choose valid product variants for every unit';end if;
  for option_record in select * from jsonb_each(product_record.options) loop if not option_record.value ? coalesce(unit_options->>option_record.key,'') then raise exception 'Choose valid product variants for every unit';end if;end loop;
  for option_record in select * from jsonb_each(unit_options) loop if not product_record.options ? option_record.key then raise exception 'Invalid unit variant';end if;end loop;
  purchase_cost=null;if p_data->>'acquisition_cost_kobo' is not null then
   perform tenant_assert(p_company,'finance.manage',null,p_warehouse);
   if p_data->'cost_confirmed' is distinct from 'true'::jsonb or p_data->>'acquisition_cost_kobo'!~'^[0-9]{1,10}$' or(p_data->>'acquisition_cost_kobo')::bigint not between 0 and 1000000000 then raise exception 'Confirm the exact supporting purchase cost';end if;purchase_cost=(p_data->>'acquisition_cost_kobo')::bigint;
  end if;
  if coalesce(p_data->>'condition','new') not in ('new','used','refurbished') then raise exception 'Only inspected saleable units can enter available stock';end if;
  insert into tenant_serial_units(company_id,product_id,warehouse_id,serial,imei,options,bin,condition,supplier_id,acquisition_cost_kobo,acquisition_date,source_reference)
  values(p_company,p_product,p_warehouse,nullif(trim(unit_data->>'serial'),''),nullif(trim(unit_data->>'imei'),''),unit_options,coalesce(p_data->>'bin',''),coalesce(p_data->>'condition','new'),nullif(p_data->>'supplier_id',''),purchase_cost,(p_data->>'acquisition_date')::date,reference) returning id into new_id;
  if purchase_cost is not null then insert into tenant_serial_cost_history(company_id,unit_id,command_id,new_kobo,source_reference,actor) values(p_company,new_id,p_key,purchase_cost,reference,auth.uid());end if;
  perform tenant_serial_event(p_company,new_id,null,null,'inventory.'||p_source,p_key::text,p_data->>'note',p_key);identifiers=array_append(identifiers,new_id);
 end loop;return identifiers;
end $$;
alter function tenant_inventory_insert_units(uuid,uuid,text,text,jsonb,text) owner to edge_tenant_executor;
revoke all on function tenant_inventory_insert_units(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function tenant_inventory_insert_units(uuid,uuid,text,text,jsonb,text) to edge_tenant_executor;

create function tenant_inventory_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;product_record products;unit_record tenant_serial_units;pid text;wid text;result jsonb;ids uuid[];qty integer;stock_key uuid;stock_result jsonb;destination text;reference text;note text;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_key is null or p_action is null or p_action not in ('configure','enroll','activate','receive','metadata','draft-retire','draft-location') or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>256000 then raise exception 'Invalid inventory command';end if;
 perform set_config('app.tenant_id',p_company::text,true);pid=p_data->>'product_id';wid=p_data->>'warehouse_id';note=trim(coalesce(p_data->>'note',''));reference=trim(coalesce(p_data->>'reference',''));
 if p_action='metadata' then
  select * into unit_record from tenant_serial_units where company_id=p_company and id=(p_data->>'unit_id')::uuid;
  if not found then raise exception 'Unit unavailable';end if;pid=unit_record.product_id;wid=unit_record.warehouse_id;
 end if;
 if p_action in ('configure','activate') then perform tenant_assert(p_company,'catalogue.edit');perform tenant_assert(p_company,'inventory.adjust');
 else if wid is null then raise exception 'Choose the physical warehouse';end if;perform tenant_assert(p_company,'inventory.adjust',null,wid);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if found then if prior.actor<>auth.uid() or prior.action<>'inventory.'||p_action or prior.payload<>p_data then raise exception 'Idempotency key already used with different input';end if;return prior.result;end if;
 if p_action='receive' then perform tenant_finance_ensure(p_company);end if;
 select * into product_record from products where company_id=p_company and id=pid and archived_at is null for update;if not found then raise exception 'Product unavailable';end if;
 if p_action='configure' then
  if coalesce(p_data->>'safety_stock','')!~'^[0-9]{1,7}$' or coalesce(p_data->>'lead_time_days','')!~'^[0-9]{1,3}$' or coalesce(p_data->>'warranty_days','')!~'^[0-9]{1,4}$' then raise exception 'Provide valid stock and warranty policy values';end if;
  insert into tenant_tracking_products(company_id,product_id,safety_stock,maximum_stock,lead_time_days,warranty_days,configured_by) values(p_company,pid,(p_data->>'safety_stock')::integer,(p_data->>'maximum_stock')::integer,(p_data->>'lead_time_days')::integer,(p_data->>'warranty_days')::integer,auth.uid()) on conflict(company_id,product_id) do update set safety_stock=excluded.safety_stock,maximum_stock=excluded.maximum_stock,lead_time_days=excluded.lead_time_days,warranty_days=excluded.warranty_days,configured_by=auth.uid(),configured_at=now();
 elsif p_action='activate' then
  if product_record.active or tenant_serial_enabled(p_company,pid) or p_data->'verified' is distinct from 'true'::jsonb or length(note) not between 10 and 1000 then raise exception 'Temporarily unpublish this product and verify the complete serial stock count before activation';end if;
  if exists(select 1 from tenant_inventory where company_id=p_company and product_id=pid and reserved>0) then raise exception 'Resolve or expire every reservation before serial activation';end if;
  if exists(select 1 from tenant_custody_releases r where r.company_id=p_company and r.product_id=pid and(r.status in ('requested','approved') or(r.status='released' and r.quantity-r.sold-r.returned-r.received-r.damaged-r.missing>0))) then raise exception 'Resolve open release requests and physically reconcile outstanding custody before activation';end if;
  perform tenant_serial_assert_balance(p_company,pid);
  insert into tenant_tracking_products(company_id,product_id,mode,configured_by) values(p_company,pid,'serial',auth.uid()) on conflict(company_id,product_id) do update set mode='serial',configured_by=auth.uid(),configured_at=now();
  -- Independent deferred constraint validates every warehouse after mode changes.
  perform tenant_serial_assert_balance(p_company,pid);
 elsif p_action in ('enroll','receive') then
  if p_action='enroll' then
   if product_record.active or tenant_serial_enabled(p_company,pid) then raise exception 'Enroll only temporarily unpublished, untracked stock; use identified receiving after activation';end if;
   if not exists(select 1 from tenant_inventory where company_id=p_company and warehouse_id=wid and product_id=pid and reserved=0) then raise exception 'Resolve reservations before identifying existing stock';end if;
  elsif not tenant_serial_enabled(p_company,pid) then raise exception 'Activate reconciled serial tracking before identified receiving';end if;
  ids=tenant_inventory_insert_units(p_company,p_key,pid,wid,p_data,p_action);qty=cardinality(ids);
  if p_action='enroll' then
   if(select physical from tenant_serial_totals where company_id=p_company and product_id=pid and warehouse_id=wid)>(select on_hand from tenant_inventory where company_id=p_company and product_id=pid and warehouse_id=wid) then raise exception 'Enrolled identities exceed existing physical stock; enrollment does not receive new goods';end if;
  else
   if coalesce(p_data->>'classification','') not in ('opening','received_unbilled') then raise exception 'Classify identified receipts as verified opening stock or goods awaiting invoice';end if;
   stock_key=md5(p_company::text||p_key::text||'inventory.receive.stock')::uuid;
   stock_result=tenant_business_command(p_company,stock_key,'stock',jsonb_build_object('warehouse_id',wid,'product_id',pid,'delta',qty,'classification',p_data->>'classification','reason',note,'source_command',p_key));
  end if;result=jsonb_build_object('id',p_key,'unit_ids',to_jsonb(ids),'quantity',qty,'stock_command_id',stock_key,'stock',stock_result);
 elsif p_action in ('draft-retire','draft-location') then
  if product_record.active or tenant_serial_enabled(p_company,pid) or p_data->'verified' is distinct from 'true'::jsonb or length(note) not between 10 and 1000 then raise exception 'Draft identity corrections require an unpublished, untracked product and verified physical evidence';end if;
  qty=jsonb_array_length(p_data->'unit_ids');if qty not between 1 and 200 then raise exception 'Select 1 to 200 draft units';end if;ids=tenant_serial_select(p_company,pid,wid,qty,null,p_data->'unit_ids');
  if exists(select 1 from tenant_serial_pos_links where company_id=p_company and unit_id=any(ids)) or exists(select 1 from tenant_serial_order_links where company_id=p_company and unit_id=any(ids)) or exists(select 1 from tenant_serial_requested_links where company_id=p_company and unit_id=any(ids)) then raise exception 'Posted source identities require their original return or correction workflow';end if;
  if p_action='draft-location' then
   destination=p_data->>'destination_warehouse';perform tenant_assert(p_company,'inventory.adjust',null,destination);
   if destination=wid or not exists(select 1 from tenant_inventory where company_id=p_company and product_id=pid and warehouse_id=destination and reserved=0 and on_hand-coalesce((select physical from tenant_serial_totals where company_id=p_company and product_id=pid and warehouse_id=destination),0)>=qty) then raise exception 'Destination has insufficient unidentified physical stock for these draft labels';end if;
  end if;
  perform tenant_serial_transition(p_company,ids,'available',case when p_action='draft-retire' then 'retired' else 'available' end,'inventory.'||p_action,p_key::text,note,p_key,'{}',destination);
 elsif p_action='metadata' then
  select * into unit_record from tenant_serial_units where company_id=p_company and id=unit_record.id for update;
  wid=unit_record.warehouse_id;perform tenant_assert(p_company,'inventory.adjust',null,wid);
  if length(note) not between 10 and 1000 or length(reference) not between 6 and 160 then raise exception 'Record the metadata correction and supporting evidence';end if;
  if p_data ? 'warranty_until' then perform tenant_assert(p_company,'catalogue.edit');end if;
  if p_data ? 'acquisition_cost_kobo' then
   perform tenant_assert(p_company,'finance.manage',null,wid);if p_data->'cost_confirmed' is distinct from 'true'::jsonb or coalesce(p_data->>'acquisition_cost_kobo','')!~'^[0-9]{1,10}$' or(p_data->>'acquisition_cost_kobo')::bigint not between 0 and 1000000000 then raise exception 'Confirm the supporting exact purchase cost';end if;
   insert into tenant_serial_cost_history(company_id,unit_id,command_id,previous_kobo,new_kobo,source_reference,actor) values(p_company,unit_record.id,p_key,unit_record.acquisition_cost_kobo,(p_data->>'acquisition_cost_kobo')::bigint,reference,auth.uid());
  end if;
  update tenant_serial_units set bin=coalesce(p_data->>'bin',bin),warranty_until=case when p_data?'warranty_until' then(p_data->>'warranty_until')::date else warranty_until end,acquisition_cost_kobo=case when p_data?'acquisition_cost_kobo' then(p_data->>'acquisition_cost_kobo')::bigint else acquisition_cost_kobo end where company_id=p_company and id=unit_record.id;
  perform tenant_serial_event(p_company,unit_record.id,unit_record.state,unit_record.warehouse_id,'inventory.metadata',p_key::text,note,p_key);result=jsonb_build_object('id',unit_record.id);
 end if;
 result=coalesce(result,jsonb_build_object('id',pid,'mode',case when tenant_serial_enabled(p_company,pid) then 'serial' else 'none' end));
 insert into tenant_business_commands(company_id,id,actor,action,payload,result) values(p_company,p_key,auth.uid(),'inventory.'||p_action,p_data,result);perform platform_log(p_company,'inventory.'||p_action,jsonb_build_object('command',p_key,'result',result));return result;
end $$;
alter function tenant_inventory_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_inventory_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_inventory_command(uuid,uuid,text,jsonb) to authenticated;
