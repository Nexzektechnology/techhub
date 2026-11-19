-- Extend the established POS graph; keep flagship operations behind their RLS boundary.
do $$ declare t text;r record;begin
 for r in select p.oid::regprocedure::text signature from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.prosrc~'\m(pos_sales|pos_items|pos_reservations|pos_receipts|pos_refunds)\M' and p.proname!~'^tenant_' loop
  execute format('alter function %s owner to edge_legacy_executor',r.signature);
 end loop;
 foreach t in array array['pos_sales','pos_items','pos_reservations','pos_receipts','pos_refunds'] loop
  execute format('alter table %I drop constraint legacy_flagship_only',t);
  execute format('drop policy legacy_company_boundary on %I',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
 end loop;
end $$;
alter table pos_sales drop constraint pos_sales_method_check;
alter table pos_sales add constraint pos_sales_method_check check(method in ('cash','bank_transfer','paystack','split','credit','pos_terminal'));
alter table pos_sales drop constraint pos_sales_status_check;
alter table pos_sales add constraint pos_sales_status_check check(status in ('reserved','paid','cancelled','expired','refunded','credit','partially_paid'));
alter table tenant_customers add column credit_limit_kobo bigint not null default 0 check(credit_limit_kobo between 0 and 100000000000);
alter table tenant_customers add column payment_terms_days integer not null default 0 check(payment_terms_days between 0 and 365);
create table tenant_registers(company_id uuid not null,id uuid not null default gen_random_uuid(),warehouse_id text not null,name text not null check(length(trim(name)) between 2 and 100),active boolean not null default true,primary key(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),unique(company_id,warehouse_id,name));
create table tenant_cashier_sessions(company_id uuid not null,id uuid not null,register_id uuid not null,cashier_id uuid not null references profiles(id),opening_kobo bigint not null check(opening_kobo between 0 and 100000000000),opened_at timestamptz not null default now(),closed_at timestamptz,counted_kobo bigint check(counted_kobo between 0 and 100000000000),expected_kobo bigint,closing_note text,primary key(company_id,id),foreign key(company_id,register_id) references tenant_registers(company_id,id));
create unique index tenant_register_open on tenant_cashier_sessions(company_id,register_id) where closed_at is null;
create unique index tenant_cashier_open on tenant_cashier_sessions(company_id,cashier_id) where closed_at is null;
alter table pos_sales add column warehouse_id text;
alter table pos_sales add column session_id uuid;
alter table pos_sales add column business_customer_id uuid;
alter table pos_sales add column subtotal_kobo bigint;
alter table pos_sales add column discount_kobo bigint not null default 0 check(discount_kobo>=0);
alter table pos_sales add column tax_kobo bigint not null default 0 check(tax_kobo>=0);
alter table pos_sales add column paid_kobo bigint not null default 0 check(paid_kobo>=0);
alter table pos_sales add column returned_kobo bigint not null default 0 check(returned_kobo>=0);
alter table pos_sales add column due_date date;
alter table pos_sales add column channel text not null default 'pos' check(channel in ('pos','physical_store','wholesale','field','direct','b2b'));
alter table pos_sales add column approval_note text;
alter table pos_sales add constraint tenant_pos_warehouse foreign key(company_id,warehouse_id) references warehouses(company_id,id);
alter table pos_sales add constraint tenant_pos_session foreign key(company_id,session_id) references tenant_cashier_sessions(company_id,id);
alter table pos_sales add constraint tenant_pos_customer foreign key(company_id,business_customer_id) references tenant_customers(company_id,id);
alter table pos_sales add constraint tenant_pos_location check(company_id='10000000-0000-4000-8000-000000000001' or(warehouse_id is not null and session_id is not null and subtotal_kobo is not null));
alter table pos_items add column regular_price_kobo bigint;
alter table pos_items add column unit_cost_kobo bigint not null default 0 check(unit_cost_kobo>=0);
alter table pos_items add column tax_kobo bigint not null default 0 check(tax_kobo>=0);
create unique index tenant_pos_item_identity on pos_items(company_id,id);
create index tenant_pos_location_date on pos_sales(company_id,warehouse_id,created_at desc,id);
create index tenant_pos_debt on pos_sales(company_id,business_customer_id,due_date) where status in ('credit','partially_paid');
create table tenant_pos_tenders(company_id uuid not null,id uuid not null default gen_random_uuid(),sale_id uuid not null,session_id uuid not null,command_id uuid not null,method text not null check(method in ('cash','bank_transfer','pos_terminal')),amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),tendered_kobo bigint not null check(tendered_kobo between amount_kobo and 100000000000),reference text not null check(length(reference)<=160),confirmation text not null default 'staff_confirmed' check(confirmation='staff_confirmed'),actor uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,sale_id) references pos_sales(company_id,id),foreign key(company_id,session_id) references tenant_cashier_sessions(company_id,id));
create unique index tenant_tender_external_reference on tenant_pos_tenders(company_id,lower(reference)) where method<>'cash';
create table tenant_pos_holds(company_id uuid not null,id uuid not null,warehouse_id text not null,actor uuid not null references profiles(id),label text not null check(length(label) between 2 and 100),cart jsonb not null,created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id));
create table tenant_pos_returns(company_id uuid not null,id uuid not null,sale_id uuid not null,session_id uuid not null,amount_kobo bigint not null check(amount_kobo>0),refund_kobo bigint not null check(refund_kobo>=0),refund_method text check(refund_method in ('cash','bank_transfer','pos_terminal')),reason text not null check(length(reason) between 10 and 500),actor uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,sale_id) references pos_sales(company_id,id),foreign key(company_id,session_id) references tenant_cashier_sessions(company_id,id));
create table tenant_pos_return_items(company_id uuid not null,return_id uuid not null,item_id uuid not null,quantity integer not null check(quantity between 1 and 50),amount_kobo bigint not null check(amount_kobo>0),disposition text not null check(disposition in ('resellable','damaged')),primary key(company_id,return_id,item_id),foreign key(company_id,return_id) references tenant_pos_returns(company_id,id),foreign key(company_id,item_id) references pos_items(company_id,id));
create table tenant_pos_settings(company_id uuid primary key references platform_companies(id),tax_bps integer not null default 0 check(tax_bps between 0 and 10000),tax_label text not null default 'Tax' check(length(tax_label) between 2 and 60),version integer not null default 1 check(version>0));
alter table pos_sales add column tax_label text;
alter table pos_sales add column tax_bps integer not null default 0;
alter table pos_sales add column tax_version integer not null default 1;
alter table tenant_business_commands drop constraint tenant_business_commands_action_check;
alter table tenant_business_commands add constraint tenant_business_commands_action_check check(action in ('customer','supplier','product-master','stock','pos.register','pos.open','pos.close','pos.sale','pos.payment','pos.return','pos.hold','pos.credit','pos.tax'));

do $$ declare t text;begin
 foreach t in array array['tenant_registers','tenant_cashier_sessions','tenant_pos_tenders','tenant_pos_holds','tenant_pos_returns','tenant_pos_return_items','tenant_pos_settings'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert,update,delete on %I to edge_tenant_executor',t);
 end loop;
 foreach t in array array['tenant_pos_tenders','tenant_pos_returns','tenant_pos_return_items','pos_items','pos_receipts','pos_refunds'] loop
  execute format('create trigger business_immutable before update or delete on %I for each row execute function business_immutable_evidence()',t);
 end loop;
end $$;

-- This projection deliberately excludes unit costs and the original command payload.
create function tenant_pos_sale_json(p_company uuid,p_sale uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select (to_jsonb(s)-'fingerprint')||jsonb_build_object('balance_kobo',greatest(0,s.total_kobo-s.returned_kobo-s.paid_kobo),
 'items',coalesce((select jsonb_agg(to_jsonb(i)-'unit_cost_kobo' order by i.id) from pos_items i where i.company_id=p_company and i.sale_id=s.id),'[]'),
 'tenders',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from tenant_pos_tenders t where t.company_id=p_company and t.sale_id=s.id),'[]'),
 'returns',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(ri)) from tenant_pos_return_items ri where ri.company_id=p_company and ri.return_id=r.id))) from tenant_pos_returns r where r.company_id=p_company and r.sale_id=s.id),'[]'))
 from pos_sales s where s.company_id=p_company and s.id=p_sale
$$;
create function tenant_pos_refresh(p_company uuid,p_sale uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$ begin
 update pos_sales s set status=case when returned_kobo=total_kobo then 'refunded' when paid_kobo>=total_kobo-returned_kobo then 'paid' when paid_kobo=0 then 'credit' else 'partially_paid' end where company_id=p_company and id=p_sale;
 insert into pos_receipts(company_id,sale_id,method,amount_kobo,tender_kobo,external_reference,confirmed_by,note)
 select p_company,id,method,total_kobo,coalesce((select sum(tendered_kobo) from tenant_pos_tenders where company_id=p_company and sale_id=p_sale),total_kobo),'tenant-pos-'||id,auth.uid(),'Staff-confirmed tender records; see individual sources' from pos_sales where company_id=p_company and id=p_sale and paid_kobo>=total_kobo and returned_kobo=0 on conflict(sale_id) do nothing;
end $$;

create function tenant_pos_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;wid text;sid uuid;session tenant_cashier_sessions;sale pos_sales;customer tenant_customers;p products;line jsonb;t jsonb;movement record;opt record;
 result jsonb;total bigint:=0;subtotal bigint:=0;discount bigint:=0;tax bigint:=0;paid bigint:=0;unit_price bigint;line_tax bigint;taxrate integer:=0;taxlabel text:='Tax';taxversion integer:=1;
 countqty integer;amount bigint;returned_qty integer;returned_amount bigint;return_total bigint:=0;refund bigint;cash_expected bigint;method text;reference text;item pos_items;approval text;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_key is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>64000 then raise exception 'Invalid command';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_action in ('register','credit','tax') then
  perform tenant_assert(p_company,case when p_action='register' then 'locations.manage' else 'finance.manage' end);
 else
  wid=p_data->>'warehouse_id';
  if p_action in ('payment','return') then select warehouse_id into wid from pos_sales where company_id=p_company and id=(p_data->>'sale_id')::uuid;if not found then raise exception 'Sale unavailable';end if;end if;
  if p_action='close' then select r.warehouse_id into wid from tenant_cashier_sessions cs join tenant_registers r on r.company_id=cs.company_id and r.id=cs.register_id where cs.company_id=p_company and cs.id=(p_data->>'session_id')::uuid;end if;
  if p_action='open' then select warehouse_id into wid from tenant_registers where company_id=p_company and id=(p_data->>'register_id')::uuid and active;end if;
  if wid is null then raise exception 'Location unavailable';end if;
  perform tenant_assert(p_company,'orders.manage',null,wid);
 end if;
 if p_action not in ('register','open','close','sale','payment','return','hold','credit','tax') then raise exception 'Invalid POS action';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if found then if prior.actor<>auth.uid() or prior.action<>'pos.'||p_action or prior.payload<>p_data then raise exception 'Idempotency key already used with different input';end if;return prior.result;end if;
 if p_action='register' then
  wid=p_data->>'warehouse_id';if not tenant_permission(p_company,'orders.manage',null,wid) or length(trim(coalesce(p_data->>'name',''))) not between 2 and 100 then raise exception 'Invalid register';end if;
  insert into tenant_registers(company_id,id,warehouse_id,name) values(p_company,p_key,wid,trim(p_data->>'name'));result=jsonb_build_object('id',p_key);
 elsif p_action='tax' then
  if coalesce(p_data->>'tax_bps','')!~'^[0-9]{1,5}$' or(p_data->>'tax_bps')::integer>10000 or length(trim(coalesce(p_data->>'label',''))) not between 2 and 60 then raise exception 'Invalid tax rule';end if;
  insert into tenant_pos_settings(company_id,tax_bps,tax_label) values(p_company,(p_data->>'tax_bps')::integer,trim(p_data->>'label')) on conflict(company_id) do update set tax_bps=excluded.tax_bps,tax_label=excluded.tax_label,version=tenant_pos_settings.version+1;result=jsonb_build_object('ok',true);
 elsif p_action='credit' then
  if coalesce(p_data->>'limit_kobo','')!~'^[0-9]{1,12}$' or coalesce(p_data->>'terms_days','')!~'^[0-9]{1,3}$' then raise exception 'Invalid credit terms';end if;
  update tenant_customers set credit_limit_kobo=(p_data->>'limit_kobo')::bigint,payment_terms_days=(p_data->>'terms_days')::integer where company_id=p_company and id=(p_data->>'customer_id')::uuid and active;
  if not found then raise exception 'Customer unavailable';end if;result=jsonb_build_object('id',p_data->>'customer_id');
 elsif p_action='open' then
  if coalesce(p_data->>'opening_kobo','')!~'^[0-9]{1,12}$' then raise exception 'Invalid opening cash';end if;
  insert into tenant_cashier_sessions(company_id,id,register_id,cashier_id,opening_kobo) values(p_company,p_key,(p_data->>'register_id')::uuid,auth.uid(),(p_data->>'opening_kobo')::bigint);result=jsonb_build_object('id',p_key);
 elsif p_action='close' then
  select * into session from tenant_cashier_sessions where company_id=p_company and id=(p_data->>'session_id')::uuid for update;
  if not found or session.closed_at is not null or(session.cashier_id<>auth.uid() and not tenant_permission(p_company,'finance.manage',null,wid)) then raise exception 'Open cashier session required';end if;
  if coalesce(p_data->>'counted_kobo','')!~'^[0-9]{1,12}$' or length(trim(coalesce(p_data->>'note',''))) not between 5 and 500 then raise exception 'Count the cash and enter a closing note';end if;
  select session.opening_kobo+coalesce((select sum(amount_kobo) from tenant_pos_tenders cash_tender where cash_tender.company_id=p_company and cash_tender.session_id=session.id and cash_tender.method='cash'),0)-coalesce((select sum(refund_kobo) from tenant_pos_returns where company_id=p_company and session_id=session.id and refund_method='cash'),0) into cash_expected;
  update tenant_cashier_sessions set closed_at=now(),counted_kobo=(p_data->>'counted_kobo')::bigint,expected_kobo=cash_expected,closing_note=trim(p_data->>'note') where company_id=p_company and id=session.id;
  result=jsonb_build_object('id',session.id,'expected_kobo',cash_expected,'variance_kobo',(p_data->>'counted_kobo')::bigint-cash_expected);
 elsif p_action='hold' then
  if length(trim(coalesce(p_data->>'label',''))) not between 2 and 100 or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 50 then raise exception 'Invalid held cart';end if;
  insert into tenant_pos_holds(company_id,id,warehouse_id,actor,label,cart) values(p_company,p_key,wid,auth.uid(),trim(p_data->>'label'),p_data);result=jsonb_build_object('id',p_key);
 else
  select cs.* into session from tenant_cashier_sessions cs join tenant_registers r on r.company_id=cs.company_id and r.id=cs.register_id where cs.company_id=p_company and cs.id=(p_data->>'session_id')::uuid and r.warehouse_id=wid and r.active for update of cs;
  if not found or session.closed_at is not null or session.cashier_id<>auth.uid() then raise exception 'Your open cashier session is required';end if;
  if p_action='sale' then
   if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 50 or jsonb_typeof(p_data->'tenders') is distinct from 'array' or jsonb_array_length(p_data->'tenders')>10 or coalesce(p_data->>'channel','') not in ('pos','physical_store','wholesale','field','direct','b2b') then raise exception 'Invalid sale';end if;
   if p_data->>'customer_id' is not null then select * into customer from tenant_customers where company_id=p_company and id=(p_data->>'customer_id')::uuid and active for update;if not found then raise exception 'Customer unavailable';end if;end if;
   select tax_bps,tax_label,version into taxrate,taxlabel,taxversion from tenant_pos_settings where company_id=p_company;taxrate=coalesce(taxrate,0);taxlabel=coalesce(taxlabel,'Tax');taxversion=coalesce(taxversion,1);
   for line in select value from jsonb_array_elements(p_data->'items') loop
    if coalesce(line->>'quantity','')!~'^[0-9]{1,2}$' or(line->>'quantity')::integer not between 1 and 50 or jsonb_typeof(coalesce(line->'options','{}'))<>'object' then raise exception 'Invalid item quantity or options';end if;
   end loop;
   for movement in select value->>'product_id' product_id,sum((value->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_data->'items') group by 1 order by 1 loop
    select * into p from products where company_id=p_company and id=movement.product_id and active and archived_at is null for update;if not found then raise exception 'Product unavailable';end if;
    if not exists(select 1 from tenant_inventory where company_id=p_company and warehouse_id=wid and product_id=p.id and on_hand-reserved>=movement.quantity) then raise exception 'Insufficient available stock: %',p.name;end if;
   end loop;
   approval=trim(coalesce(p_data->>'approval_note',''));
   for line in select value from jsonb_array_elements(p_data->'items') loop
    select * into p from products where company_id=p_company and id=line->>'product_id';
    if coalesce(line->>'expected_price_kobo','')!~'^[0-9]{1,10}$' or(line->>'expected_price_kobo')::bigint<>p.price_kobo then raise exception 'Prices changed; refresh and review the sale';end if;
    unit_price=case when p_data->>'channel'='wholesale' then coalesce(p.wholesale_kobo,p.price_kobo) else p.price_kobo end;
    if line->>'unit_price_kobo' is not null then if line->>'unit_price_kobo'!~'^[0-9]{1,10}$' then raise exception 'Invalid unit price';end if;unit_price=(line->>'unit_price_kobo')::bigint;end if;
    if unit_price not between 1 and 1000000000 then raise exception 'Invalid unit price';end if;
    if unit_price<greatest(p.minimum_price_kobo,p.cost_kobo) and(not tenant_permission(p_company,'finance.manage',null,wid) or length(approval) not between 10 and 500) then raise exception 'This price needs finance approval and a recorded reason';end if;
    for opt in select * from jsonb_each(p.options) loop if not opt.value ? coalesce(line->'options'->>opt.key,'') then raise exception 'Select a valid %',opt.key;end if;end loop;
    for opt in select * from jsonb_each(coalesce(line->'options','{}')) loop if not p.options ? opt.key then raise exception 'Invalid product option';end if;end loop;
    amount=unit_price*(line->>'quantity')::integer;line_tax=round(amount::numeric*taxrate/10000)::bigint;
    subtotal=subtotal+p.price_kobo*(line->>'quantity')::integer;discount=discount+(p.price_kobo-unit_price)*(line->>'quantity')::integer;tax=tax+line_tax;total=total+amount+line_tax;
   end loop;
   if total not between 1 and 100000000000 or discount<0 then raise exception 'Sale total or discount is outside the supported range';end if;
   if p_data ? 'expected_total_kobo' and(coalesce(p_data->>'expected_total_kobo','')!~'^[0-9]{1,12}$' or(p_data->>'expected_total_kobo')::bigint<>total) then raise exception 'The sale total changed; review prices and tax before posting';end if;
   for t in select value from jsonb_array_elements(p_data->'tenders') loop
    if coalesce(t->>'amount_kobo','')!~'^[0-9]{1,12}$' or(t->>'amount_kobo')::bigint<=0 then raise exception 'Invalid tender amount';end if;paid=paid+(t->>'amount_kobo')::bigint;
   end loop;
   if paid>total then raise exception 'Allocate the exact amount received after giving change';end if;
   if paid<total then
    perform tenant_assert(p_company,'finance.manage',null,wid);
    if customer.id is null then raise exception 'Choose a customer for a credit sale';end if;
    if coalesce((select sum(greatest(0,total_kobo-returned_kobo-paid_kobo)) from pos_sales where company_id=p_company and business_customer_id=customer.id),0)+total-paid>customer.credit_limit_kobo then raise exception 'Customer credit limit exceeded';end if;
   end if;
   method=case when jsonb_array_length(p_data->'tenders')=0 then 'credit' when jsonb_array_length(p_data->'tenders')>1 then 'split' else p_data#>>'{tenders,0,method}' end;
   sid=p_key;
   insert into pos_sales(company_id,id,created_by,buyer,method,status,total_kobo,reference,fingerprint,warehouse_id,session_id,business_customer_id,subtotal_kobo,discount_kobo,tax_kobo,paid_kobo,due_date,channel,approval_note,tax_bps,tax_label,tax_version)
   values(p_company,sid,auth.uid(),jsonb_build_object('name',coalesce(customer.name,'Walk-in customer'),'phone',coalesce(customer.phone,''),'email',coalesce(customer.email,'')),method,'paid',total,'tenant-pos-'||sid,md5(p_data::text),wid,session.id,customer.id,subtotal,discount,tax,paid,case when paid<total then (now() at time zone 'Africa/Lagos')::date+customer.payment_terms_days else null end,p_data->>'channel',nullif(approval,''),taxrate,taxlabel,taxversion);
   for line in select value from jsonb_array_elements(p_data->'items') loop
    select * into p from products where company_id=p_company and id=line->>'product_id';unit_price=coalesce((line->>'unit_price_kobo')::bigint,case when p_data->>'channel'='wholesale' then coalesce(p.wholesale_kobo,p.price_kobo) else p.price_kobo end);
    insert into pos_items(company_id,sale_id,product_id,name,quantity,price_kobo,regular_price_kobo,unit_cost_kobo,options,tax_kobo) values(p_company,sid,p.id,p.name,(line->>'quantity')::integer,unit_price,p.price_kobo,p.cost_kobo,coalesce(line->'options','{}'),round(unit_price*(line->>'quantity')::integer::numeric*taxrate/10000)::bigint);
   end loop;
   for movement in select product_id,sum(quantity)::integer quantity from pos_items where company_id=p_company and sale_id=sid group by product_id order by product_id loop
    update tenant_inventory set on_hand=on_hand-movement.quantity where company_id=p_company and warehouse_id=wid and product_id=movement.product_id;
    insert into stock_movements(company_id,product_id,warehouse_id,pos_sale_id,quantity,reason,actor) values(p_company,movement.product_id,wid,sid,-movement.quantity,'POS completed sale',auth.uid());perform tenant_stock_sync(p_company,movement.product_id);
   end loop;
   if p_data->>'hold_id' is not null then delete from tenant_pos_holds where company_id=p_company and id=(p_data->>'hold_id')::uuid and actor=auth.uid();end if;
  else
   sid=(p_data->>'sale_id')::uuid;select * into sale from pos_sales where company_id=p_company and id=sid for update;
   if sale.status not in ('paid','credit','partially_paid') then raise exception 'Sale cannot accept this operation';end if;
   if p_action='payment' then
    if jsonb_typeof(p_data->'tenders') is distinct from 'array' or jsonb_array_length(p_data->'tenders') not between 1 and 10 then raise exception 'Record received payment';end if;
    for t in select value from jsonb_array_elements(p_data->'tenders') loop
     if coalesce(t->>'amount_kobo','')!~'^[0-9]{1,12}$' or(t->>'amount_kobo')::bigint<=0 then raise exception 'Invalid payment amount';end if;paid=paid+(t->>'amount_kobo')::bigint;
    end loop;
    if paid>sale.total_kobo-sale.returned_kobo-sale.paid_kobo then raise exception 'Payment exceeds the outstanding balance';end if;
    update pos_sales set paid_kobo=paid_kobo+paid where company_id=p_company and id=sid;
   else
    perform tenant_assert(p_company,'finance.manage',null,wid);
    if p_data->'verified' is distinct from 'true'::jsonb or length(trim(coalesce(p_data->>'reason',''))) not between 10 and 500 or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 50 then raise exception 'Verify returned goods and record a reason';end if;
    if(select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'items'))<>jsonb_array_length(p_data->'items') then raise exception 'Duplicate return item';end if;
    for line in select value from jsonb_array_elements(p_data->'items') loop
     select * into item from pos_items where company_id=p_company and sale_id=sid and id=(line->>'item_id')::uuid;if not found then raise exception 'Sale item unavailable';end if;
     if coalesce(line->>'quantity','')!~'^[0-9]{1,2}$' or(line->>'quantity')::integer not between 1 and 50 or coalesce(line->>'disposition','') not in ('resellable','damaged') then raise exception 'Invalid returned quantity or condition';end if;
     select coalesce(sum(quantity),0),coalesce(sum(amount_kobo),0) into returned_qty,returned_amount from tenant_pos_return_items where company_id=p_company and item_id=item.id;
     if returned_qty+(line->>'quantity')::integer>item.quantity then raise exception 'Return exceeds the sold quantity';end if;
     return_total=return_total+((item.quantity*item.price_kobo+item.tax_kobo)*(returned_qty+(line->>'quantity')::integer)/item.quantity-returned_amount);
    end loop;
    refund=greatest(0,return_total-greatest(0,sale.total_kobo-sale.returned_kobo-sale.paid_kobo));
    if refund>0 then
     if p_data->'refund_confirmed' is distinct from 'true'::jsonb or coalesce(p_data->>'refund_method','') not in ('cash','bank_transfer','pos_terminal') or length(trim(coalesce(p_data->>'reference',''))) not between 6 and 150 then raise exception 'Confirm the completed refund and its external reference';end if;
     insert into pos_refunds(company_id,id,sale_id,amount_kobo,external_reference,note,confirmed_by) values(p_company,p_key,sid,refund,'tenant-'||p_company::text||'-'||lower(trim(p_data->>'reference')),trim(p_data->>'reason'),auth.uid());
    end if;
    insert into tenant_pos_returns(company_id,id,sale_id,session_id,amount_kobo,refund_kobo,refund_method,reason,actor) values(p_company,p_key,sid,session.id,return_total,refund,case when refund>0 then p_data->>'refund_method' end,trim(p_data->>'reason'),auth.uid());
    -- Lock products in a deterministic order before changing physical inventory.
    perform 1 from products where company_id=p_company and id in(select product_id from pos_items where company_id=p_company and id in(select(value->>'item_id')::uuid from jsonb_array_elements(p_data->'items'))) order by id for update;
    for line in select value from jsonb_array_elements(p_data->'items') loop
     select * into item from pos_items where company_id=p_company and sale_id=sid and id=(line->>'item_id')::uuid;
     select coalesce(sum(quantity),0),coalesce(sum(amount_kobo),0) into returned_qty,returned_amount from tenant_pos_return_items where company_id=p_company and item_id=item.id;
     amount=(item.quantity*item.price_kobo+item.tax_kobo)*(returned_qty+(line->>'quantity')::integer)/item.quantity-returned_amount;
     insert into tenant_pos_return_items values(p_company,p_key,item.id,(line->>'quantity')::integer,amount,line->>'disposition');
     if line->>'disposition'='resellable' then
      perform tenant_assert(p_company,'inventory.adjust',null,wid);
      update tenant_inventory set on_hand=on_hand+(line->>'quantity')::integer where company_id=p_company and warehouse_id=wid and product_id=item.product_id;
      insert into stock_movements(company_id,product_id,warehouse_id,pos_sale_id,quantity,reason,actor) values(p_company,item.product_id,wid,sid,(line->>'quantity')::integer,'Verified customer return',auth.uid());perform tenant_stock_sync(p_company,item.product_id);
     end if;
    end loop;
    update pos_sales set returned_kobo=returned_kobo+return_total where company_id=p_company and id=sid;
   end if;
  end if;
  if p_action in ('sale','payment') then
   for t in select value from jsonb_array_elements(p_data->'tenders') loop
    method=t->>'method';reference=trim(coalesce(t->>'reference',''));
    if method is null or method not in ('cash','bank_transfer','pos_terminal') or t->'received' is distinct from 'true'::jsonb then raise exception 'Confirm funds were actually received';end if;
    if method<>'cash' then perform tenant_assert(p_company,'finance.manage',null,wid);if length(reference) not between 6 and 150 then raise exception 'Record the actual bank or terminal reference';end if;end if;
    if t ? 'tendered_kobo' and coalesce(t->>'tendered_kobo','')!~'^[0-9]{1,12}$' then raise exception 'Invalid tendered amount';end if;
    if coalesce((t->>'tendered_kobo')::bigint,(t->>'amount_kobo')::bigint)<(t->>'amount_kobo')::bigint or(method<>'cash' and coalesce((t->>'tendered_kobo')::bigint,(t->>'amount_kobo')::bigint)<>(t->>'amount_kobo')::bigint) then raise exception 'Invalid change allocation';end if;
    insert into tenant_pos_tenders(company_id,sale_id,session_id,command_id,method,amount_kobo,tendered_kobo,reference,actor) values(p_company,sid,session.id,p_key,method,(t->>'amount_kobo')::bigint,coalesce((t->>'tendered_kobo')::bigint,(t->>'amount_kobo')::bigint),case when method='cash' then 'cash-'||gen_random_uuid() else reference end,auth.uid());
   end loop;
  end if;
  perform tenant_pos_refresh(p_company,sid);result=tenant_pos_sale_json(p_company,sid);
 end if;
 insert into tenant_business_commands(company_id,id,actor,action,payload,result) values(p_company,p_key,auth.uid(),'pos.'||p_action,p_data,result);
 perform platform_log(p_company,'pos.'||p_action,jsonb_build_object('command',p_key,'result_id',result->>'id'));
 return result;
end $$;

create function tenant_pos_snapshot(p_company uuid,p_warehouse text default null,p_query text default '',p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$ begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid filters';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_warehouse is not null and not tenant_permission(p_company,'orders.read',null,p_warehouse) then raise exception 'Forbidden';end if;
 return jsonb_build_object('affiliates_available',tenant_any_permission(p_company,'affiliates.read'),'finance_available',tenant_any_permission(p_company,'finance.read'),'access',saas_access(p_company),'can_configure',tenant_permission(p_company,'locations.manage'),'can_finance',tenant_any_permission(p_company,'finance.manage'),
 'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from warehouses where company_id=p_company and active and tenant_permission(p_company,'orders.read',null,id)),'[]'),
 'registers',coalesce((select jsonb_agg(to_jsonb(r)) from tenant_registers r where company_id=p_company and active and(p_warehouse is null or warehouse_id=p_warehouse) and tenant_permission(p_company,'orders.manage',null,warehouse_id)),'[]'),
 'sessions',coalesce((select jsonb_agg(to_jsonb(cs)) from tenant_cashier_sessions cs join tenant_registers r on r.company_id=cs.company_id and r.id=cs.register_id where cs.company_id=p_company and(cs.cashier_id=auth.uid() or tenant_permission(p_company,'finance.read',null,r.warehouse_id)) and(p_warehouse is null or r.warehouse_id=p_warehouse) and tenant_permission(p_company,'orders.read',null,r.warehouse_id) and(cs.closed_at is null or cs.closed_at>now()-interval '7 days')),'[]'),
 'products',coalesce((select jsonb_agg(to_jsonb(p)) from(select p.id,p.name,p.sku,p.barcode,p.price_kobo,p.wholesale_kobo,p.options,i.warehouse_id,i.on_hand-i.reserved available from products p join tenant_inventory i on i.company_id=p.company_id and i.product_id=p.id where p.company_id=p_company and p.active and p.archived_at is null and tenant_permission(p_company,'orders.manage',null,i.warehouse_id) and(p_warehouse is null or i.warehouse_id=p_warehouse) and(p_query='' or strpos(lower(concat_ws(' ',p.name,p.sku,p.barcode)),lower(p_query))>0) order by p.name,p.id,i.warehouse_id limit 50 offset(p_page-1)*50)p),'[]'),
 'customers',coalesce((select jsonb_agg(to_jsonb(c)) from(select id,name,phone from tenant_customers where company_id=p_company and active and tenant_any_permission(p_company,'orders.manage') order by name,id limit 100)c),'[]'),
 'holds',coalesce((select jsonb_agg(to_jsonb(h)) from tenant_pos_holds h where company_id=p_company and actor=auth.uid() and(p_warehouse is null or warehouse_id=p_warehouse) and tenant_permission(p_company,'orders.manage',null,warehouse_id)),'[]'),
 'sales',coalesce((select jsonb_agg(tenant_pos_sale_json(p_company,s.id)) from(select id from pos_sales where company_id=p_company and tenant_permission(p_company,'orders.read',null,warehouse_id) and(p_warehouse is null or warehouse_id=p_warehouse) order by created_at desc,id limit 25 offset(p_page-1)*25)s),'[]'),
 'sale_count',(select count(*) from pos_sales where company_id=p_company and tenant_permission(p_company,'orders.read',null,warehouse_id) and(p_warehouse is null or warehouse_id=p_warehouse)),
 'tax',coalesce((select to_jsonb(t) from tenant_pos_settings t where company_id=p_company),'{}'));
end $$;

alter function tenant_pos_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
alter function tenant_pos_snapshot(uuid,text,text,integer) owner to edge_tenant_executor;
revoke all on function tenant_pos_sale_json(uuid,uuid),tenant_pos_refresh(uuid,uuid),tenant_pos_command(uuid,uuid,text,jsonb),tenant_pos_snapshot(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function tenant_pos_sale_json(uuid,uuid),tenant_pos_refresh(uuid,uuid) to edge_tenant_executor;
grant execute on function tenant_pos_command(uuid,uuid,text,jsonb),tenant_pos_snapshot(uuid,text,text,integer) to authenticated;

create function tenant_pos_command_status(p_company uuid,p_key uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;begin
 if not tenant_verified_user() or company_role(p_company) is null or p_key is null then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 -- Wait for an ambiguous in-flight write before saying that a key is absent.
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if not found then return jsonb_build_object('committed',false);end if;
 if prior.actor<>auth.uid() or prior.action<>'pos.sale' then raise exception 'Forbidden';end if;
 return jsonb_build_object('committed',true,'reference',prior.result->>'reference');
end $$;
alter function tenant_pos_command_status(uuid,uuid) owner to edge_tenant_executor;
revoke all on function tenant_pos_command_status(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_pos_command_status(uuid,uuid) to authenticated;

create function tenant_operation_rate_limit(p_company uuid,p_action text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare used integer;begin
 if not tenant_verified_user() or company_role(p_company) is null then raise exception 'Forbidden';end if;
 if p_action is null or p_action not in ('pos','finance','procurement','custody','inventory') then raise exception 'Invalid action';end if;
 insert into saas_rate_limits values(auth.uid(),'ops:'||p_company::text||':'||p_action,date_trunc('minute',now()),1) on conflict(user_id,action,bucket) do update set n=saas_rate_limits.n+1 returning n into used;
 if used>120 then raise exception 'Request limit reached; try again in a minute';end if;
 delete from saas_rate_limits where user_id=auth.uid() and bucket<now()-interval '1 day';
end $$;
revoke all on function tenant_operation_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function tenant_operation_rate_limit(uuid,text) to authenticated;
