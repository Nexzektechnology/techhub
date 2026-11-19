-- Custody is a physical location, never a bank balance. Wholesale ownership
-- transfers at release; consignment ownership transfers only on verified sale.
alter table tenant_roles drop constraint tenant_roles_permissions_check;
alter table tenant_roles add constraint tenant_roles_permissions_check check(cardinality(permissions) between 1 and 30 and permissions<@array['catalogue.read','catalogue.edit','inventory.read','inventory.adjust','orders.read','orders.manage','finance.read','finance.manage','procurement.manage','reports.read','locations.manage','team.manage','storefront.manage','affiliates.read','affiliates.manage','affiliates.approve']);
alter table tenant_business_commands drop constraint tenant_business_commands_action_check;
alter table tenant_business_commands add constraint tenant_business_commands_action_check check(action in ('customer','supplier','product-master','stock','pos.register','pos.open','pos.close','pos.sale','pos.payment','pos.return','pos.hold','pos.credit','pos.tax') or action~'^finance[.](setup|account|manual|reverse|period|expense|bill|pay|collect|bank-import|bank-match|bank-unmatch|transfer)$' or action~'^affiliate[.](register|request|approve|reject-request|cancel|release|acknowledge|sale|sale-declare|return-declare|declaration-reject|inspect|loss|remit|commission-pay|refund|receive)$');
create table tenant_affiliates(
 company_id uuid not null references platform_companies,id uuid not null,name text not null check(length(trim(name)) between 2 and 200),
 email text not null default '' check(length(email)<=254 and email=lower(trim(email))),phone text not null default '' check(length(phone)<=40),address text not null default '' check(length(address)<=500),notes text not null default '' check(length(notes)<=2000),active boolean not null default true,
 created_at timestamptz not null default now(),primary key(company_id,id)
);
create unique index tenant_affiliate_email on tenant_affiliates(company_id,email) where email<>'';
create table tenant_custody_releases(
 company_id uuid not null,id uuid not null,affiliate_id uuid not null,warehouse_id text not null,destination_warehouse text,product_id text not null,
 relationship text not null check(relationship in ('consignment','wholesale_credit','temporary','interbranch','field_agent','sales_rep')),
 quantity integer not null check(quantity between 1 and 10000),settlement_kobo bigint not null check(settlement_kobo between 0 and 1000000000),expected_price_kobo bigint not null check(expected_price_kobo between 0 and 1000000000),commission_bps integer not null check(commission_bps between 0 and 10000),unit_cost_kobo bigint not null default 0,tax_bps integer not null default 0 check(tax_bps between 0 and 10000),tax_version integer not null default 1,tax_label text not null default 'Tax',tax_charged_kobo bigint not null default 0,tax_credited_kobo bigint not null default 0,
 collection_date date not null,settlement_deadline date not null,return_deadline date not null,terms text not null check(length(terms) between 10 and 2000),
 requested_by uuid not null references profiles,approved_by uuid references profiles,approval_note text,released_by uuid references profiles,released_at timestamptz,acknowledged_by uuid references profiles,acknowledged_at timestamptz,acknowledgement text,
 status text not null default 'requested' check(status in ('requested','approved','released','closed','cancelled','rejected')),
 sold integer not null default 0,received integer not null default 0,returned integer not null default 0,damaged integer not null default 0,missing integer not null default 0,
 charged_kobo bigint not null default 0,credited_kobo bigint not null default 0,remitted_kobo bigint not null default 0,refunded_kobo bigint not null default 0,commission_kobo bigint not null default 0,commission_paid_kobo bigint not null default 0,
 created_at timestamptz not null default now(),primary key(company_id,id),
 foreign key(company_id,affiliate_id) references tenant_affiliates(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,destination_warehouse) references warehouses(company_id,id),foreign key(company_id,product_id) references products(company_id,id),
 check(sold>=0 and received>=0 and returned>=0 and damaged>=0 and missing>=0 and sold+returned+received+damaged+missing<=quantity),check(commission_paid_kobo between 0 and commission_kobo),check(relationship='interbranch' or destination_warehouse is null),check(destination_warehouse is null or destination_warehouse<>warehouse_id),check(settlement_deadline>=collection_date and return_deadline>=collection_date),check(relationship not in ('temporary','interbranch') or(settlement_kobo=0 and commission_bps=0)),check(relationship<>'wholesale_credit' or commission_bps=0)
);
create index tenant_custody_due on tenant_custody_releases(company_id,affiliate_id,settlement_deadline,id);
create table tenant_custody_declarations(
 company_id uuid not null,id uuid not null,release_id uuid not null,kind text not null check(kind in ('sale','return')),quantity integer not null check(quantity between 1 and 10000),processed integer not null default 0,actor uuid not null references profiles,note text not null check(length(note) between 10 and 500),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,release_id) references tenant_custody_releases(company_id,id),check(processed between 0 and quantity)
);
create table tenant_custody_events(
 company_id uuid not null,id uuid not null,release_id uuid not null,action text not null,quantity integer not null default 0,amount_kobo bigint not null default 0,commission_kobo bigint not null default 0,data jsonb not null,actor uuid not null references profiles,journal_id uuid,created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,release_id) references tenant_custody_releases(company_id,id),foreign key(company_id,journal_id) references tenant_journals(company_id,id),foreign key(company_id,id) references tenant_business_commands(company_id,id) deferrable initially deferred
);
do $$ declare t text;begin
 foreach t in array array['tenant_affiliates','tenant_custody_releases','tenant_custody_declarations','tenant_custody_events'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert,update on %I to edge_tenant_executor',t);
 end loop;
end $$;
create trigger tenant_custody_events_immutable before update or delete on tenant_custody_events for each row execute function business_immutable_evidence();

create function tenant_affiliate_self(p_company uuid,p_affiliate uuid) returns boolean language sql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
 select tenant_verified_user() and exists(select 1 from tenant_affiliates a join auth.users u on u.id=auth.uid() and lower(u.email)=a.email where a.company_id=p_company and a.id=p_affiliate and a.email<>'' and a.active)
$$;
revoke all on function tenant_affiliate_self(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_affiliate_self(uuid,uuid) to edge_tenant_executor;

create function tenant_affiliate_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;rel tenant_custody_releases;decl tenant_custody_declarations;item products;result jsonb;aid uuid;wid text;is_self boolean:=false;qty integer:=0;amount bigint:=0;commission bigint:=0;cost bigint:=0;balance bigint;available integer;payment_account text;reference text;note text;entry uuid;lines jsonb:='[]';net_value bigint:=0;tax_value bigint:=0;tax_rate integer;tax_version integer;tax_label text;custody_account text;destination_entry uuid;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 if not tenant_verified_user() or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_key is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid affiliate command';end if;
 if not saas_can_write(p_company) then raise exception 'Subscription is read-only';end if;
 if p_company='10000000-0000-4000-8000-000000000001' then raise exception 'Use the existing flagship operations workspace';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_action='request' then wid=p_data->>'warehouse_id';aid=(p_data->>'affiliate_id')::uuid;
 elsif p_action<>'register' then
  select * into rel from tenant_custody_releases r where r.company_id=p_company and r.id=(p_data->>'release_id')::uuid for update;
  if not found then raise exception 'Release unavailable';end if;wid=rel.warehouse_id;aid=rel.affiliate_id;is_self=tenant_affiliate_self(p_company,aid);
 end if;
 if p_action='register' then perform tenant_assert(p_company,'affiliates.manage');
 elsif p_action in ('approve','reject-request') then perform tenant_assert(p_company,'affiliates.approve',null,wid);
 elsif p_action in ('remit','commission-pay','refund') then perform tenant_assert(p_company,'finance.manage',null,wid);
 elsif p_action in ('acknowledge','sale-declare','return-declare') and is_self then null;
 else perform tenant_assert(p_company,'affiliates.manage',null,wid);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if found then if prior.actor<>auth.uid() or prior.action<>'affiliate.'||p_action or prior.payload<>p_data then raise exception 'Idempotency key already used with different input';end if;return prior.result;end if;
 note=trim(coalesce(p_data->>'note',''));reference=trim(coalesce(p_data->>'reference',''));
 select coalesce(t.tax_bps,0),coalesce(t.version,1),coalesce(t.tax_label,'Tax') into tax_rate,tax_version,tax_label from tenant_pos_settings t where t.company_id=p_company;tax_rate=coalesce(tax_rate,0);tax_version=coalesce(tax_version,1);tax_label=coalesce(tax_label,'Tax');custody_account=case when rel.relationship='interbranch' then '1220' else '1230' end;
 if p_action='register' then
  aid=coalesce((p_data->>'id')::uuid,p_key);
  if length(trim(coalesce(p_data->>'name',''))) not between 2 and 200 or length(coalesce(p_data->>'email',''))>254 or coalesce(p_data->>'email','')!~'^([^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+)?$' then raise exception 'Record a valid affiliate name and email';end if;
  if exists(select 1 from tenant_affiliates a where a.company_id=p_company and a.id=aid and a.email<>lower(trim(coalesce(p_data->>'email',''))) and exists(select 1 from tenant_custody_releases r where r.company_id=a.company_id and r.affiliate_id=a.id and r.status not in ('cancelled','rejected'))) then raise exception 'Portal identity is locked after a release request; create a separate partner account for another recipient';end if;
  insert into tenant_affiliates(company_id,id,name,email,phone,address,notes,active) values(p_company,aid,trim(p_data->>'name'),lower(trim(coalesce(p_data->>'email',''))),coalesce(p_data->>'phone',''),coalesce(p_data->>'address',''),coalesce(p_data->>'notes',''),coalesce((p_data->>'active')::boolean,true)) on conflict(company_id,id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,address=excluded.address,notes=excluded.notes,active=excluded.active;
  result=jsonb_build_object('id',aid);
 elsif p_action='request' then
  if not exists(select 1 from tenant_affiliates where company_id=p_company and id=aid and active) then raise exception 'Affiliate unavailable';end if;
  if coalesce(p_data->>'quantity','')!~'^[0-9]{1,5}$' or coalesce(p_data->>'settlement_kobo','')!~'^[0-9]{1,10}$' or coalesce(p_data->>'expected_price_kobo','')!~'^[0-9]{1,10}$' or coalesce(p_data->>'commission_bps','')!~'^[0-9]{1,5}$' then raise exception 'Record valid quantity and agreed prices';end if;
  if p_data->>'relationship' not in ('temporary','interbranch') and(p_data->>'settlement_kobo')::bigint<1 then raise exception 'Sales relationships require a settlement price';end if;
  if p_data->>'relationship'='interbranch' and(not tenant_permission(p_company,'affiliates.manage',null,p_data->>'destination_warehouse') or p_data->>'destination_warehouse' is null) then raise exception 'Choose an authorized destination warehouse';end if;
  if not exists(select 1 from products where company_id=p_company and id=p_data->>'product_id' and active and archived_at is null) then raise exception 'Product unavailable';end if;
  insert into tenant_custody_releases(company_id,id,affiliate_id,warehouse_id,destination_warehouse,product_id,relationship,quantity,settlement_kobo,expected_price_kobo,commission_bps,collection_date,settlement_deadline,return_deadline,terms,requested_by,tax_bps,tax_version,tax_label) values(p_company,p_key,aid,wid,p_data->>'destination_warehouse',p_data->>'product_id',p_data->>'relationship',(p_data->>'quantity')::integer,(p_data->>'settlement_kobo')::bigint,(p_data->>'expected_price_kobo')::bigint,(p_data->>'commission_bps')::integer,(p_data->>'collection_date')::date,(p_data->>'settlement_deadline')::date,(p_data->>'return_deadline')::date,p_data->>'terms',auth.uid(),tax_rate,tax_version,tax_label);
  rel.id=p_key;result=jsonb_build_object('id',p_key);
 else
  available=rel.quantity-rel.sold-rel.returned-rel.received-rel.damaged-rel.missing;balance=rel.charged_kobo-rel.credited_kobo-rel.remitted_kobo+rel.refunded_kobo;
  if p_action='approve' then
   if not exists(select 1 from tenant_affiliates where company_id=p_company and id=aid and active) then raise exception 'Partner unavailable or inactive';end if;
   if rel.status<>'requested' then raise exception 'Only requested releases can be approved';end if;
   if rel.requested_by=auth.uid() then raise exception 'A different approving manager must review this release';end if;
   if length(note) not between 10 and 500 then raise exception 'Record the approval and price review reason';end if;
   update tenant_custody_releases set approved_by=auth.uid(),approval_note=note,status='approved' where company_id=p_company and id=rel.id;
  elsif p_action in ('cancel','reject-request') then
   if rel.status not in ('requested','approved') or length(note) not between 10 and 500 then raise exception 'Only unreleased requests can be cancelled with a reason';end if;
   update tenant_custody_releases set status=case when p_action='reject-request' then 'rejected' else 'cancelled' end where company_id=p_company and id=rel.id;
  elsif p_action='release' then
   if not exists(select 1 from tenant_affiliates where company_id=p_company and id=aid and active) then raise exception 'Partner unavailable or inactive';end if;
   perform tenant_assert(p_company,'inventory.adjust',null,wid);
   if rel.relationship not in ('temporary','interbranch') and (rel.tax_bps,rel.tax_version,rel.tax_label) is distinct from (tax_rate,tax_version,tax_label) then raise exception 'Tax configuration changed; cancel and submit a new release request for review';end if;
   if rel.status<>'approved' or p_data->'confirmed' is distinct from 'true'::jsonb or length(reference) not between 6 and 160 then raise exception 'Approve and confirm the actual handover with its reference';end if;
   perform tenant_finance_ensure(p_company);select * into item from products where company_id=p_company and id=rel.product_id for update;
   if not item.active or item.archived_at is not null then raise exception 'Product unavailable';end if;
   if rel.relationship not in ('temporary','interbranch') and rel.settlement_kobo<greatest(item.cost_kobo,item.minimum_price_kobo) then raise exception 'Settlement price is below the protected cost or minimum price';end if;
   update tenant_inventory set on_hand=on_hand-rel.quantity where company_id=p_company and warehouse_id=wid and product_id=rel.product_id and on_hand-reserved>=rel.quantity;
   if not found then raise exception 'Insufficient available stock; reservations remain protected';end if;
   qty=rel.quantity;cost=item.cost_kobo*qty;
   insert into stock_movements(company_id,warehouse_id,product_id,quantity,reason,actor,command_id) values(p_company,wid,rel.product_id,-qty,'Affiliate custody release · '||rel.id,auth.uid(),p_key);perform tenant_stock_sync(p_company,rel.product_id);
   if rel.relationship='wholesale_credit' then
    net_value=rel.settlement_kobo*qty;tax_value=round(net_value::numeric*rel.tax_bps/10000)::bigint;amount=net_value+tax_value;lines=jsonb_build_array(tenant_finance_line('1110',amount,0),tenant_finance_line('4000',0,net_value));if tax_value>0 then lines=lines||jsonb_build_array(tenant_finance_line('2100',0,tax_value));end if;if cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5000',cost,0),tenant_finance_line('1200',0,cost));end if;
   elsif cost>0 then lines=jsonb_build_array(tenant_finance_line(custody_account,cost,0),tenant_finance_line('1200',0,cost));end if;
   update tenant_custody_releases set status='released',released_by=auth.uid(),released_at=now(),unit_cost_kobo=item.cost_kobo,charged_kobo=amount,tax_charged_kobo=tax_value where company_id=p_company and id=rel.id;
  else
   if rel.status not in ('released','closed') then raise exception 'The goods have not been physically released';end if;
   if p_action='acknowledge' then
    if rel.acknowledged_at is not null then raise exception 'Receipt already acknowledged';end if;
    if p_data->'confirmed' is distinct from 'true'::jsonb or length(note) not between 10 and 500 then raise exception 'Confirm receipt and record recipient evidence';end if;
    update tenant_custody_releases set acknowledged_by=auth.uid(),acknowledged_at=now(),acknowledgement=case when is_self then 'Recipient: ' else 'Staff attestation: ' end||note where company_id=p_company and id=rel.id;
   elsif p_action='declaration-reject' then
    select * into decl from tenant_custody_declarations d where d.company_id=p_company and d.id=(p_data->>'declaration_id')::uuid and d.release_id=rel.id for update;
    if not found or decl.processed=decl.quantity or length(note) not between 10 and 500 then raise exception 'Choose an unresolved declaration and record the rejection reason';end if;
    qty=decl.quantity-decl.processed;update tenant_custody_declarations set processed=quantity where company_id=p_company and id=decl.id;
   elsif p_action in ('sale','sale-declare','return-declare','inspect','loss','receive') then
    if coalesce(p_data->>'quantity','')!~'^[0-9]{1,5}$' or(p_data->>'quantity')::integer not between 1 and available or length(note) not between 10 and 500 then raise exception 'Record a valid custody quantity and verification note';end if;qty=(p_data->>'quantity')::integer;cost=rel.unit_cost_kobo*qty;
    if p_action in ('sale','sale-declare') and rel.relationship in ('temporary','interbranch') then raise exception 'This custody relationship does not authorize sales';end if;
    if p_action in ('sale-declare','return-declare') then
     if qty>available-coalesce((select sum(d.quantity-d.processed) from tenant_custody_declarations d where d.company_id=p_company and d.release_id=rel.id),0) then raise exception 'Pending declarations already cover these goods';end if;
     insert into tenant_custody_declarations values(p_company,p_key,rel.id,case when p_action='sale-declare' then 'sale' else 'return' end,qty,0,auth.uid(),note,now());
    else
     if p_data->'verified' is distinct from 'true'::jsonb then raise exception 'Verify the physical goods or completed sale';end if;
     if p_data->>'declaration_id' is not null then
      select * into decl from tenant_custody_declarations d where d.company_id=p_company and d.id=(p_data->>'declaration_id')::uuid and d.release_id=rel.id for update;
      if not found or decl.quantity-decl.processed<qty or(decl.kind='sale' and p_action<>'sale') or(decl.kind='return' and p_action<>'inspect') then raise exception 'Declaration unavailable or already inspected';end if;
      update tenant_custody_declarations set processed=processed+qty where company_id=p_company and id=decl.id;
     elsif p_action='inspect' then raise exception 'Select the declared return being inspected';
     elsif qty>available-coalesce((select sum(d.quantity-d.processed) from tenant_custody_declarations d where d.company_id=p_company and d.release_id=rel.id),0) then raise exception 'Resolve pending declarations before consuming these goods';end if;
     if p_action='sale' then
      if rel.acknowledged_at is null then raise exception 'Record recipient acknowledgement before confirming sales';end if;
      if rel.relationship<>'wholesale_credit' then
       net_value=qty*rel.settlement_kobo;tax_value=round((rel.sold+qty)::numeric*rel.settlement_kobo*rel.tax_bps/10000)::bigint-rel.tax_charged_kobo;amount=net_value+tax_value;commission=((rel.sold+qty)::bigint*rel.settlement_kobo*rel.commission_bps/10000)-(rel.sold::bigint*rel.settlement_kobo*rel.commission_bps/10000);
       lines=jsonb_build_array(tenant_finance_line('1110',amount,0),tenant_finance_line('4000',0,net_value));if tax_value>0 then lines=lines||jsonb_build_array(tenant_finance_line('2100',0,tax_value));end if;if cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5000',cost,0),tenant_finance_line(custody_account,0,cost));end if;if commission>0 then lines=lines||jsonb_build_array(tenant_finance_line('6100',commission,0),tenant_finance_line('2200',0,commission));end if;
      end if;
      update tenant_custody_releases set sold=sold+qty,charged_kobo=charged_kobo+amount,tax_charged_kobo=tax_charged_kobo+tax_value,commission_kobo=commission_kobo+commission where company_id=p_company and id=rel.id;
     elsif p_action='inspect' then
      if p_data->>'disposition' not in ('resellable','damaged') or p_data->>'disposition' is null then raise exception 'Record the inspection disposition';end if;
      if p_data->>'disposition'='resellable' then
       perform tenant_assert(p_company,'inventory.adjust',null,wid);perform 1 from products where company_id=p_company and id=rel.product_id for update;
       update tenant_inventory set on_hand=on_hand+qty where company_id=p_company and warehouse_id=wid and product_id=rel.product_id;
       insert into stock_movements(company_id,warehouse_id,product_id,quantity,reason,actor,command_id) values(p_company,wid,rel.product_id,qty,'Inspected custody return · '||rel.id,auth.uid(),p_key);perform tenant_stock_sync(p_company,rel.product_id);
      end if;
      if rel.relationship='wholesale_credit' then
       net_value=qty*rel.settlement_kobo;tax_value=round((rel.returned+rel.damaged+qty)::numeric*rel.settlement_kobo*rel.tax_bps/10000)::bigint-rel.tax_credited_kobo;amount=net_value+tax_value;lines=jsonb_build_array(tenant_finance_line('4100',net_value,0),tenant_finance_line('1110',0,amount));if tax_value>0 then lines=lines||jsonb_build_array(tenant_finance_line('2100',tax_value,0));end if;
       if cost>0 and p_data->>'disposition'='resellable' then lines=lines||jsonb_build_array(tenant_finance_line('1200',cost,0),tenant_finance_line('5000',0,cost));elsif cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5100',cost,0),tenant_finance_line('5000',0,cost));end if;
      elsif cost>0 then lines=case when p_data->>'disposition'='damaged' then jsonb_build_array(tenant_finance_line('5100',cost,0),tenant_finance_line(custody_account,0,cost)) else jsonb_build_array(tenant_finance_line('1200',cost,0),tenant_finance_line(custody_account,0,cost)) end;end if;
      update tenant_custody_releases set returned=returned+case when p_data->>'disposition'='resellable' then qty else 0 end,damaged=damaged+case when p_data->>'disposition'='damaged' then qty else 0 end,credited_kobo=credited_kobo+amount,tax_credited_kobo=tax_credited_kobo+tax_value where company_id=p_company and id=rel.id;
     elsif p_action='loss' then
      perform tenant_assert(p_company,'affiliates.approve',null,wid);if cost>0 and rel.relationship<>'wholesale_credit' then lines=jsonb_build_array(tenant_finance_line('5100',cost,0),tenant_finance_line(custody_account,0,cost));end if;
      update tenant_custody_releases set missing=missing+qty where company_id=p_company and id=rel.id;
     else
      if rel.relationship<>'interbranch' then raise exception 'Only interbranch custody can be received at another warehouse';end if;perform tenant_assert(p_company,'inventory.adjust',null,rel.destination_warehouse);
      perform 1 from products where company_id=p_company and id=rel.product_id for update;
      insert into tenant_inventory(company_id,warehouse_id,product_id,on_hand) values(p_company,rel.destination_warehouse,rel.product_id,qty) on conflict(company_id,warehouse_id,product_id) do update set on_hand=tenant_inventory.on_hand+qty;
      insert into stock_movements(company_id,warehouse_id,product_id,quantity,reason,actor,command_id) values(p_company,rel.destination_warehouse,rel.product_id,qty,'Interbranch custody received · '||rel.id,auth.uid(),p_key);perform tenant_stock_sync(p_company,rel.product_id);
      if cost>0 then
       lines=jsonb_build_array(tenant_finance_line('1290',cost,0),tenant_finance_line('1220',0,cost));
       destination_entry=tenant_finance_post(p_company,'affiliate.receive.destination',p_key::text,today,rel.destination_warehouse,'Interbranch inventory received · '||rel.id,jsonb_build_array(tenant_finance_line('1200',cost,0),tenant_finance_line('1290',0,cost)),jsonb_build_object('command_id',p_key,'release_id',rel.id,'flow','noncash'));
      end if;
      update tenant_custody_releases set received=received+qty where company_id=p_company and id=rel.id;
     end if;
    end if;
   elsif p_action in ('remit','commission-pay','refund') then
    if coalesce(p_data->>'amount_kobo','')!~'^[0-9]{1,12}$' or(p_data->>'amount_kobo')::bigint not between 1 and 100000000000 or p_data->'confirmed' is distinct from 'true'::jsonb or length(reference) not between 6 and 160 then raise exception 'Confirm the actual funds and their reference';end if;
    amount=(p_data->>'amount_kobo')::bigint;payment_account=p_data->>'payment_account';
    if not exists(select 1 from tenant_accounts where company_id=p_company and code=payment_account and active and kind='asset' and subtype in ('cash','bank','clearing')) then raise exception 'Choose a cash or bank account';end if;
    if p_action='remit' then
     if amount>balance then raise exception 'Remittance exceeds the outstanding affiliate balance';end if;
     lines=jsonb_build_array(tenant_finance_line(payment_account,amount,0),tenant_finance_line('1110',0,amount));update tenant_custody_releases set remitted_kobo=remitted_kobo+amount where company_id=p_company and id=rel.id;
    elsif p_action='refund' then
     if amount> -balance then raise exception 'Refund exceeds the affiliate credit balance';end if;
     lines=jsonb_build_array(tenant_finance_line('1110',amount,0),tenant_finance_line(payment_account,0,amount));update tenant_custody_releases set refunded_kobo=refunded_kobo+amount where company_id=p_company and id=rel.id;
    else
     if amount>rel.commission_kobo-rel.commission_paid_kobo or balance>0 then raise exception 'Settle remittances before paying earned commission';end if;
     lines=jsonb_build_array(tenant_finance_line('2200',amount,0),tenant_finance_line(payment_account,0,amount));update tenant_custody_releases set commission_paid_kobo=commission_paid_kobo+amount where company_id=p_company and id=rel.id;
    end if;
   else raise exception 'Invalid affiliate action';end if;
  end if;result=jsonb_build_object('id',rel.id,'event_id',p_key);
 end if;
 if p_action<>'register' then
  if jsonb_array_length(lines)>0 then
   perform tenant_finance_ensure(p_company);
   entry=tenant_finance_post(p_company,'affiliate.'||p_action,p_key::text,today,wid,'Affiliate '||p_action||' · '||rel.id,lines,jsonb_build_object('command_id',p_key,'release_id',rel.id,'tax_bps',rel.tax_bps,'tax_version',rel.tax_version,'tax_kobo',tax_value,'flow',case when p_action in ('remit','commission-pay','refund') then 'operating' else 'noncash' end));
   if p_action='remit' then perform tenant_finance_cash_event(p_company,entry,1,'affiliate.remit',p_key::text,payment_account,amount,reference);
   elsif p_action in ('commission-pay','refund') then perform tenant_finance_cash_event(p_company,entry,2,'affiliate.'||p_action,p_key::text,payment_account,-amount,reference);end if;
  end if;
  insert into tenant_custody_events values(p_company,p_key,rel.id,p_action,qty,amount,commission,p_data,auth.uid(),entry,now());
  update tenant_custody_releases set status='closed' where company_id=p_company and id=rel.id and status='released' and sold+returned+received+damaged+missing=quantity and charged_kobo-credited_kobo-remitted_kobo+refunded_kobo=0 and commission_paid_kobo=commission_kobo;
 end if;
 insert into tenant_business_commands(company_id,id,actor,action,payload,result) values(p_company,p_key,auth.uid(),'affiliate.'||p_action,p_data,result);
 perform platform_log(p_company,'affiliate.'||p_action,jsonb_build_object('command',p_key,'result',result));return result;
end $$;
alter function tenant_affiliate_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_affiliate_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_affiliate_command(uuid,uuid,text,jsonb) to authenticated;

create function tenant_affiliate_context(p_slug text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare c platform_companies;begin
 if not tenant_verified_user() then raise exception 'Authentication required';end if;
 select x.id,x.slug,x.name,x.brand into c.id,c.slug,c.name,c.brand from tenant_public_company(p_slug) x;
 if not found or not tenant_commerce_enabled(c.id) then raise exception 'Company unavailable';end if;
 perform set_config('app.tenant_id',c.id::text,true);
 if not tenant_any_permission(c.id,'affiliates.read') and not exists(select 1 from tenant_affiliates a where a.company_id=c.id and tenant_affiliate_self(c.id,a.id)) then raise exception 'Forbidden';end if;
 return jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'brand',c.brand);
end $$;
alter function tenant_affiliate_context(text) owner to edge_tenant_executor;
revoke all on function tenant_affiliate_context(text) from public,anon,authenticated;
grant execute on function tenant_affiliate_context(text) to authenticated;

create function tenant_affiliate_snapshot(p_company uuid,p_affiliate uuid default null,p_release uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb;begin
 if not tenant_verified_user() or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid page';end if;
 if not tenant_any_permission(p_company,'affiliates.read') and not exists(select 1 from tenant_affiliates a where a.company_id=p_company and tenant_affiliate_self(p_company,a.id)) then raise exception 'Forbidden';end if;
 if p_release is not null and not exists(select 1 from tenant_custody_releases r where r.company_id=p_company and r.id=p_release and(tenant_permission(p_company,'affiliates.read',null,r.warehouse_id) or tenant_affiliate_self(p_company,r.affiliate_id))) then raise exception 'Release unavailable';end if;
 return jsonb_build_object('access',saas_access(p_company),'is_staff',tenant_any_permission(p_company,'affiliates.read'),'can_register',tenant_permission(p_company,'affiliates.manage'),'can_manage',tenant_any_permission(p_company,'affiliates.manage'),'can_finance',tenant_any_permission(p_company,'finance.manage'),'can_pos',tenant_any_permission(p_company,'orders.read'),'can_books',tenant_any_permission(p_company,'finance.read'),
 'affiliates',coalesce((select jsonb_agg(to_jsonb(a)) from tenant_affiliates a where a.company_id=p_company and(p_affiliate is null or a.id=p_affiliate) and(tenant_permission(p_company,'affiliates.read') or tenant_affiliate_self(p_company,a.id) or exists(select 1 from tenant_custody_releases r where r.company_id=a.company_id and r.affiliate_id=a.id and tenant_permission(p_company,'affiliates.read',null,r.warehouse_id)))),'[]'),
 'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)) from warehouses w where w.company_id=p_company and w.active and tenant_permission(p_company,'affiliates.manage',null,w.id)),'[]'),
 'products',case when tenant_any_permission(p_company,'affiliates.manage') then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'price_kobo',p.price_kobo,'wholesale_kobo',p.wholesale_kobo)) from products p where p.company_id=p_company and p.active and p.archived_at is null),'[]') else '[]' end,
 'accounts',case when tenant_any_permission(p_company,'finance.manage') then coalesce((select jsonb_agg(jsonb_build_object('code',a.code,'name',a.name)) from tenant_accounts a where a.company_id=p_company and a.kind='asset' and a.subtype in ('cash','bank','clearing') and a.active),'[]') else '[]' end,
 'release_count',(select count(*) from tenant_custody_releases r where r.company_id=p_company and(p_affiliate is null or r.affiliate_id=p_affiliate) and(tenant_permission(p_company,'affiliates.read',null,r.warehouse_id) or tenant_affiliate_self(p_company,r.affiliate_id))),
 'releases',coalesce((select jsonb_agg(to_jsonb(t)) from(select r.company_id,r.id,r.affiliate_id,a.name affiliate_name,r.warehouse_id,w.name warehouse_name,r.destination_warehouse,r.product_id,p.name product_name,r.relationship,r.quantity,r.settlement_kobo,r.tax_bps,r.tax_version,r.tax_label,r.tax_charged_kobo::text,r.tax_credited_kobo::text,r.expected_price_kobo,r.commission_bps,r.collection_date,r.settlement_deadline,r.return_deadline,r.terms,r.requested_by,r.approved_by,r.approval_note,r.released_by,r.released_at,r.acknowledged_by,r.acknowledged_at,r.acknowledgement,r.status,r.sold,r.returned,r.received,r.damaged,r.missing,r.quantity-r.sold-r.returned-r.received-r.damaged-r.missing custody,r.charged_kobo::text,r.credited_kobo::text,r.remitted_kobo::text,r.refunded_kobo::text,r.commission_kobo::text,r.commission_paid_kobo::text,(r.charged_kobo-r.credited_kobo-r.remitted_kobo+r.refunded_kobo)::text balance_kobo,
 case when tenant_permission(p_company,'finance.read',null,r.warehouse_id) then r.unit_cost_kobo else null end unit_cost_kobo,
 tenant_permission(p_company,'affiliates.manage',null,r.warehouse_id) can_manage,tenant_permission(p_company,'affiliates.approve',null,r.warehouse_id) can_approve,tenant_permission(p_company,'finance.manage',null,r.warehouse_id) can_finance,tenant_affiliate_self(p_company,r.affiliate_id) is_self
 from tenant_custody_releases r join tenant_affiliates a on a.company_id=r.company_id and a.id=r.affiliate_id join products p on p.company_id=r.company_id and p.id=r.product_id join warehouses w on w.company_id=r.company_id and w.id=r.warehouse_id where r.company_id=p_company and(p_affiliate is null or r.affiliate_id=p_affiliate) and(p_release is null or r.id=p_release) and(tenant_permission(p_company,'affiliates.read',null,r.warehouse_id) or tenant_affiliate_self(p_company,r.affiliate_id)) order by r.created_at desc,r.id limit 25 offset case when p_release is null then(p_page-1)*25 else 0 end)t),'[]'),
 'declarations',coalesce((select jsonb_agg(to_jsonb(d)) from tenant_custody_declarations d join tenant_custody_releases r on r.company_id=d.company_id and r.id=d.release_id where d.company_id=p_company and d.processed<d.quantity and(p_release is null or r.id=p_release) and(p_affiliate is null or r.affiliate_id=p_affiliate) and(tenant_permission(p_company,'affiliates.read',null,r.warehouse_id) or tenant_affiliate_self(p_company,r.affiliate_id))),'[]'),
 'events',case when p_release is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('amount_kobo',e.amount_kobo::text,'commission_kobo',e.commission_kobo::text)) from tenant_custody_events e where e.company_id=p_company and e.release_id=p_release),'[]') end,
 'summary',(select jsonb_build_object('custody',coalesce(sum(r.quantity-r.sold-r.returned-r.received-r.damaged-r.missing) filter(where r.status in ('released','closed')),0),'sold',coalesce(sum(r.sold),0),'returned',coalesce(sum(r.returned),0),'received',coalesce(sum(r.received),0),'damaged',coalesce(sum(r.damaged),0),'missing',coalesce(sum(r.missing),0),'balance_kobo',coalesce(sum(r.charged_kobo-r.credited_kobo-r.remitted_kobo+r.refunded_kobo),0)::text,'remitted_kobo',coalesce(sum(r.remitted_kobo),0)::text,'commission_due_kobo',coalesce(sum(r.commission_kobo-r.commission_paid_kobo),0)::text,'overdue_releases',count(*) filter(where r.status='released' and((r.settlement_deadline<(now() at time zone 'Africa/Lagos')::date and r.charged_kobo-r.credited_kobo-r.remitted_kobo+r.refunded_kobo>0) or(r.return_deadline<(now() at time zone 'Africa/Lagos')::date and r.quantity-r.sold-r.returned-r.received-r.damaged-r.missing>0)))) from tenant_custody_releases r where r.company_id=p_company and(p_affiliate is null or r.affiliate_id=p_affiliate) and(tenant_permission(p_company,'affiliates.read',null,r.warehouse_id) or tenant_affiliate_self(p_company,r.affiliate_id))));
end $$;
alter function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) owner to edge_tenant_executor;
revoke all on function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function tenant_affiliate_snapshot(uuid,uuid,uuid,integer) to authenticated;

create function tenant_affiliate_rate_limit(p_company uuid) returns void language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$ declare used integer;begin
 if not tenant_verified_user() or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if not tenant_any_permission(p_company,'affiliates.read') and not exists(select 1 from tenant_affiliates a where a.company_id=p_company and tenant_affiliate_self(p_company,a.id)) then raise exception 'Forbidden';end if;
 insert into saas_rate_limits values(auth.uid(),'ops:'||p_company::text||':custody',date_trunc('minute',now()),1) on conflict(user_id,action,bucket) do update set n=saas_rate_limits.n+1 returning n into used;
 if used>120 then raise exception 'Request limit reached; try again in a minute';end if;
 delete from saas_rate_limits where user_id=auth.uid() and bucket<now()-interval '1 day';
end $$;
revoke all on function tenant_affiliate_rate_limit(uuid) from public,anon,authenticated;
grant execute on function tenant_affiliate_rate_limit(uuid) to authenticated;

create function my_affiliate_workspaces() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('slug',c.slug,'name',c.name,'partner_name',a.name) order by c.name,a.name),'[]') from tenant_affiliates a join platform_companies c on c.id=a.company_id and c.active join auth.users u on u.id=auth.uid() and lower(u.email)=a.email where tenant_verified_user() and a.email<>'' and a.active and tenant_commerce_enabled(c.id)
$$;
revoke all on function my_affiliate_workspaces() from public,anon,authenticated;
grant execute on function my_affiliate_workspaces() to authenticated;

-- Profit coverage includes every posting channel. A zero reference cost on an
-- online/affiliate sale or write-off must not silently appear to be full profit.
alter function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) rename to tenant_finance_snapshot_before_custody;
revoke all on function tenant_finance_snapshot_before_custody(uuid,text,date,date,text,integer,boolean) from public,anon,authenticated;
create function tenant_finance_snapshot(p_company uuid,p_warehouse text default null,p_from date default null,p_to date default null,p_account text default '',p_page integer default 1,p_balance boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb;report_from date;report_to date;unknown_sales bigint;unknown_custody bigint;unknown_losses bigint;begin
 snapshot=tenant_finance_snapshot_before_custody(p_company,p_warehouse,p_from,p_to,p_account,p_page,p_balance);report_from=(snapshot->>'from')::date;report_to=(snapshot->>'to')::date;perform set_config('app.tenant_id',p_company::text,true);
 select coalesce(sum(c.quantity),0) into unknown_sales from tenant_order_costs c join tenant_journals j on j.company_id=c.company_id and j.source_kind='online-sale' and j.source_id=c.order_id::text where c.company_id=p_company and c.unit_cost_kobo=0 and j.entry_date between report_from and report_to and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id);
 select unknown_sales+coalesce(sum(e.quantity),0) into unknown_sales from tenant_custody_events e join tenant_custody_releases r on r.company_id=e.company_id and r.id=e.release_id join tenant_journals j on j.company_id=e.company_id and j.id=e.journal_id where e.company_id=p_company and r.unit_cost_kobo=0 and((e.action='release' and r.relationship='wholesale_credit') or(e.action='sale' and r.relationship<>'wholesale_credit')) and j.entry_date between report_from and report_to and(p_warehouse is null or r.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,r.warehouse_id);
 select coalesce(sum(r.quantity-r.sold-r.returned-r.received-r.damaged-r.missing),0) into unknown_custody from tenant_custody_releases r where r.company_id=p_company and r.unit_cost_kobo=0 and r.relationship<>'wholesale_credit' and r.status in ('released','closed') and(p_warehouse is null or r.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,r.warehouse_id);
 select coalesce(sum(e.quantity),0) into unknown_losses from tenant_custody_events e join tenant_custody_releases r on r.company_id=e.company_id and r.id=e.release_id where e.company_id=p_company and r.unit_cost_kobo=0 and r.relationship<>'wholesale_credit' and(e.action='loss' or(e.action='inspect' and e.data->>'disposition'='damaged')) and(e.created_at at time zone 'Africa/Lagos')::date between report_from and report_to and(p_warehouse is null or r.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,r.warehouse_id);
 return snapshot||jsonb_build_object('uncosted_units',(snapshot->>'uncosted_units')::bigint+unknown_sales,'unvalued_stock_units',(snapshot->>'unvalued_stock_units')::bigint+unknown_custody,'unvalued_loss_units',unknown_losses);
end $$;
alter function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) owner to edge_tenant_executor;
revoke all on function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) from public,anon,authenticated;
grant execute on function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) to authenticated;
