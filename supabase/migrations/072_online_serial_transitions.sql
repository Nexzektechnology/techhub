-- Existing verified checkout/payment/expiry logic stays authoritative. These
-- wrappers add identified unit transitions inside the same database transaction.
alter function tenant_order_json(uuid,uuid) rename to tenant_order_json_before_serials;
revoke all on function tenant_order_json_before_serials(uuid,uuid) from public,anon,authenticated;
create function tenant_order_json(p_company uuid,p_order uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with receipt as(select tenant_order_json_before_serials(p_company,p_order) r)
 select case when r->>'payment_status' is distinct from 'paid' then r else jsonb_set(r,'{items}',coalesce((select jsonb_agg(i||jsonb_build_object('serials',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'serial',u.serial,'imei',u.imei) order by u.id) from tenant_serial_order_links l join tenant_serial_units u on u.company_id=l.company_id and u.id=l.unit_id where l.company_id=p_company and l.item_id=(i->>'id')::uuid),'[]')) order by ord) from jsonb_array_elements(r->'items') with ordinality item(i,ord)),'[]')) end from receipt
$$;
alter function tenant_order_json(uuid,uuid) owner to edge_tenant_executor;
revoke all on function tenant_order_json(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_order_json(uuid,uuid) to edge_tenant_executor;

alter function tenant_checkout(text,jsonb) rename to tenant_checkout_before_serials;
revoke all on function tenant_checkout_before_serials(text,jsonb) from public,anon,authenticated;
create function tenant_checkout(p_slug text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare result jsonb;cid uuid;oid uuid;source_item order_items;chosen uuid[];existing_count integer;wid text;begin
 result=tenant_checkout_before_serials(p_slug,p_input);cid=(result->>'company_id')::uuid;oid=(result->>'id')::uuid;
 if cid is null or oid is null then raise exception 'Checkout source unavailable';end if;perform set_config('app.tenant_id',cid::text,true);
 if result->>'status'<>'awaiting_payment' then return result;end if;wid=result->>'warehouse_id';
 for source_item in select i.* from order_items i where i.company_id=cid and i.order_id=oid and tenant_serial_enabled(cid,i.product_id) order by i.product_id,i.id loop
  select count(*) into existing_count from tenant_serial_order_links where company_id=cid and item_id=source_item.id;
  if existing_count=source_item.quantity then continue;end if;
  if existing_count<>0 then raise exception 'Serialized reservation is incomplete; review the order';end if;
  perform 1 from products where company_id=cid and id=source_item.product_id for update;
  chosen=tenant_serial_select(cid,source_item.product_id,wid,source_item.quantity,source_item.options);
  insert into tenant_serial_order_links(company_id,item_id,unit_id) select cid,source_item.id,id from unnest(chosen) id;
  perform tenant_serial_transition(cid,chosen,'available','reserved','online.reserved',oid::text,'Online checkout reserved identified units',null,jsonb_build_object('order_id',oid,'order_item_id',source_item.id,'release_id',null,'pos_sale_id',null,'pos_item_id',null));
 end loop;return tenant_order_json(cid,oid);
end $$;
alter function tenant_checkout(text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_checkout(text,jsonb) from public,anon,authenticated;
grant execute on function tenant_checkout(text,jsonb) to authenticated;

alter function tenant_apply_payment(text,bigint,text,text,text) rename to tenant_apply_payment_before_serials;
revoke all on function tenant_apply_payment_before_serials(text,bigint,text,text,text) from public,anon,authenticated,service_role;
create function tenant_apply_payment(p_reference text,p_amount bigint,p_currency text,p_status text,p_provider text) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare result jsonb;cid uuid;oid uuid;unit_record record;chosen uuid[];warranty_days integer;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 result=tenant_apply_payment_before_serials(p_reference,p_amount,p_currency,p_status,p_provider);cid=(result->>'company_id')::uuid;oid=(result->>'id')::uuid;
 if cid is null or oid is null then raise exception 'Verified payment source unavailable';end if;perform set_config('app.tenant_id',cid::text,true);
 for unit_record in select product_id from tenant_serial_units where company_id=cid and order_id=oid and state='reserved' group by product_id order by product_id loop
  perform 1 from products where company_id=cid and id=unit_record.product_id for update;
  select array_agg(id order by id) into chosen from tenant_serial_units where company_id=cid and order_id=oid and product_id=unit_record.product_id and state='reserved';
  select t.warranty_days into warranty_days from tenant_tracking_products t where t.company_id=cid and t.product_id=unit_record.product_id;
  perform tenant_serial_transition(cid,chosen,'reserved','sold','online.verified-payment',oid::text,'Provider-verified payment consumed the reserved identified units',null,jsonb_build_object('warranty_until',case when coalesce(warranty_days,0)>0 then today+warranty_days else null end));
 end loop;return tenant_order_json(cid,oid);
end $$;
alter function tenant_apply_payment(text,bigint,text,text,text) owner to edge_tenant_executor;
revoke all on function tenant_apply_payment(text,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function tenant_apply_payment(text,bigint,text,text,text) to service_role;

alter function tenant_expire_orders(uuid) rename to tenant_expire_orders_before_serials;
revoke all on function tenant_expire_orders_before_serials(uuid) from public,anon,authenticated;
create function tenant_expire_orders(p_company uuid) returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare expired_count integer;source_order record;chosen uuid[];begin
 expired_count=tenant_expire_orders_before_serials(p_company);
 for source_order in select u.order_id,u.product_id from tenant_serial_units u join orders o on o.company_id=u.company_id and o.id=u.order_id where u.company_id=p_company and u.state='reserved' and o.status='expired' group by u.order_id,u.product_id order by u.order_id,u.product_id loop
  perform 1 from products where company_id=p_company and id=source_order.product_id for update;
  select array_agg(id order by id) into chosen from tenant_serial_units where company_id=p_company and order_id=source_order.order_id and product_id=source_order.product_id and state='reserved';
  perform tenant_serial_transition(p_company,chosen,'reserved','available','online.expired',source_order.order_id::text,'Expired online reservation released the same identified units',null,jsonb_build_object('order_id',null,'order_item_id',null));
 end loop;return expired_count;
end $$;
alter function tenant_expire_orders(uuid) owner to edge_tenant_executor;
revoke all on function tenant_expire_orders(uuid) from public,anon,authenticated;
grant execute on function tenant_expire_orders(uuid) to edge_tenant_executor;
