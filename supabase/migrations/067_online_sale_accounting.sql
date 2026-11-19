-- Gateway confirmation remains service-only and retains all original provider
-- identity/amount/currency/reservation checks. No browser redirect posts money.
create unique index tenant_order_item_identity on order_items(company_id,id);
create table tenant_order_costs(company_id uuid not null,order_id uuid not null,item_id uuid not null,product_id text not null,quantity integer not null check(quantity>0),unit_cost_kobo bigint not null check(unit_cost_kobo>=0),created_at timestamptz not null default now(),primary key(company_id,item_id),foreign key(company_id,order_id) references orders(company_id,id),foreign key(company_id,item_id) references order_items(company_id,id),foreign key(company_id,product_id) references products(company_id,id));
alter table tenant_order_costs enable row level security;
revoke all on tenant_order_costs from public,anon,authenticated;
create policy tenant_company_boundary on tenant_order_costs as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id));
create policy tenant_executor_access on tenant_order_costs for all to edge_tenant_executor using(true) with check(true);
grant select,insert on tenant_order_costs to edge_tenant_executor;
create trigger immutable_order_cost before update or delete on tenant_order_costs for each row execute function business_immutable_evidence();

alter function tenant_apply_payment(text,bigint,text,text,text) rename to tenant_apply_payment_before_accounting;
revoke all on function tenant_apply_payment_before_accounting(text,bigint,text,text,text) from public,anon,authenticated,service_role;
create function tenant_apply_payment(p_reference text,p_amount bigint,p_currency text,p_status text,p_provider text) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare cid uuid;original orders;result jsonb;lines jsonb;cost bigint;journal uuid;begin
 cid=tenant_payment_company(p_reference);if cid is null then raise exception 'Unknown tenant payment';end if;
 perform set_config('app.tenant_id',cid::text,true);
 select * into original from orders where company_id=cid and reference=p_reference;
 if original.payment_status='paid' or cid='10000000-0000-4000-8000-000000000001' then return tenant_apply_payment_before_accounting(p_reference,p_amount,p_currency,p_status,p_provider);end if;
 perform tenant_finance_ensure(cid);
 select * into original from orders where company_id=cid and reference=p_reference for update;
 result=tenant_apply_payment_before_accounting(p_reference,p_amount,p_currency,p_status,p_provider);
 if exists(select 1 from tenant_journals where company_id=cid and source_kind='online-sale' and source_id=original.id::text) then return result;end if;
 insert into tenant_order_costs(company_id,order_id,item_id,product_id,quantity,unit_cost_kobo)
 select cid,original.id,i.id,i.product_id,i.quantity,p.cost_kobo from order_items i join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=cid and i.order_id=original.id;
 select coalesce(sum(quantity*unit_cost_kobo),0) into cost from tenant_order_costs where company_id=cid and order_id=original.id;
 lines=jsonb_build_array(tenant_finance_line('1030',original.total_kobo,0));
 if original.subtotal_kobo-original.discount_kobo>0 then lines=lines||jsonb_build_array(tenant_finance_line('4000',0,original.subtotal_kobo-original.discount_kobo));end if;
 if original.delivery_kobo>0 then lines=lines||jsonb_build_array(tenant_finance_line('4010',0,original.delivery_kobo));end if;
 if cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5000',cost,0),tenant_finance_line('1200',0,cost));end if;
 journal=tenant_finance_post(cid,'online-sale',original.id::text,(now() at time zone 'Africa/Lagos')::date,original.warehouse_id,'Verified online sale · '||original.reference,lines,jsonb_build_object('order_id',original.id,'provider_id',p_provider,'verification','provider_verified','valuation','recorded_standard_cost'));
 perform tenant_finance_cash_event(cid,journal,1,'online-payment',original.id::text,'1030',original.total_kobo,p_reference);
 return result;
end $$;
alter function tenant_apply_payment(text,bigint,text,text,text) owner to edge_tenant_executor;
revoke all on function tenant_apply_payment(text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function tenant_apply_payment(text,bigint,text,text,text) to service_role;
