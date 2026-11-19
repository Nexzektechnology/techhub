-- Exact-kobo double entry. Operational evidence and the general ledger stay separate.
create table tenant_finance_config(company_id uuid primary key references platform_companies(id),started_at timestamptz not null default now(),valuation_method text not null default 'recorded_standard_cost' check(valuation_method='recorded_standard_cost'));
create table tenant_accounts(company_id uuid not null references platform_companies(id),code text not null check(code~'^[0-9]{4,10}$'),name text not null check(length(name) between 2 and 100),kind text not null check(kind in ('asset','liability','equity','revenue','cost_of_sales','expense')),subtype text not null default '',system boolean not null default false,active boolean not null default true,primary key(company_id,code));
create table tenant_accounting_periods(company_id uuid not null,id uuid not null default gen_random_uuid(),starts_on date not null,ends_on date not null,closed_at timestamptz,closed_by uuid references profiles(id),primary key(company_id,id),foreign key(company_id) references platform_companies(id),unique(company_id,starts_on),check(ends_on>=starts_on));
create table tenant_journals(company_id uuid not null,id uuid not null default gen_random_uuid(),entry_date date not null,period_id uuid not null,warehouse_id text,source_kind text not null,source_id text not null,command_id uuid,description text not null check(length(description) between 5 and 500),fingerprint text not null,actor uuid references profiles(id),created_at timestamptz not null default now(),reverses_id uuid,flow text not null default 'operating' check(flow in ('operating','investing','financing','opening','noncash')),metadata jsonb not null default '{}',primary key(company_id,id),foreign key(company_id,period_id) references tenant_accounting_periods(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,reverses_id) references tenant_journals(company_id,id),foreign key(company_id,command_id) references tenant_business_commands(company_id,id) deferrable initially deferred,unique(company_id,source_kind,source_id));
create unique index tenant_journal_single_reversal on tenant_journals(company_id,reverses_id) where reverses_id is not null;
create index tenant_journal_dates on tenant_journals(company_id,entry_date desc,warehouse_id,id);
create table tenant_journal_lines(company_id uuid not null,journal_id uuid not null,line_no integer not null,account_code text not null,debit_kobo bigint not null default 0 check(debit_kobo between 0 and 100000000000000),credit_kobo bigint not null default 0 check(credit_kobo between 0 and 100000000000000),primary key(company_id,journal_id,line_no),foreign key(company_id,journal_id) references tenant_journals(company_id,id),foreign key(company_id,account_code) references tenant_accounts(company_id,code),check((debit_kobo>0 and credit_kobo=0) or(credit_kobo>0 and debit_kobo=0)));
create index tenant_ledger_account on tenant_journal_lines(company_id,account_code,journal_id);
create table tenant_return_accounting(company_id uuid not null,return_id uuid not null,item_id uuid not null,tax_kobo bigint not null check(tax_kobo>=0),primary key(company_id,return_id,item_id),foreign key(company_id,return_id,item_id) references tenant_pos_return_items(company_id,return_id,item_id));
create table tenant_pos_tax_versions(company_id uuid not null references platform_companies(id),version integer not null,tax_bps integer not null check(tax_bps between 0 and 10000),label text not null,command_id uuid,created_at timestamptz not null default now(),primary key(company_id,version),foreign key(company_id,command_id) references tenant_business_commands(company_id,id) deferrable initially deferred);
insert into tenant_pos_tax_versions(company_id,version,tax_bps,label) select company_id,version,tax_bps,tax_label from tenant_pos_settings;
create table tenant_product_cost_history(company_id uuid not null,id uuid not null default gen_random_uuid(),product_id text not null,previous_kobo bigint not null,new_kobo bigint not null,actor uuid references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,product_id) references products(company_id,id));

do $$ declare t text;begin
 foreach t in array array['tenant_finance_config','tenant_accounts','tenant_accounting_periods','tenant_journals','tenant_journal_lines','tenant_return_accounting','tenant_pos_tax_versions','tenant_product_cost_history'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert,update,delete on %I to edge_tenant_executor',t);
 end loop;
 foreach t in array array['tenant_journals','tenant_journal_lines','tenant_return_accounting','tenant_pos_tax_versions','tenant_product_cost_history'] loop
  execute format('create trigger immutable_posted_evidence before update or delete on %I for each row execute function business_immutable_evidence()',t);
 end loop;
end $$;

-- Deferred database constraint, independent of API/function validation. Its
-- trusted trigger ownership can validate a commit after RPC-local RLS context ends.
create function tenant_require_balanced_journal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare jid uuid;cid uuid;n integer;debits numeric;credits numeric;begin
 if tg_table_name='tenant_journals' then jid=new.id;else jid=new.journal_id;end if;cid=new.company_id;
 select count(*),coalesce(sum(debit_kobo),0),coalesce(sum(credit_kobo),0) into n,debits,credits from tenant_journal_lines where company_id=cid and journal_id=jid;
 if n<2 or debits=0 or debits<>credits then raise exception 'Posted journal must have at least two balanced debit and credit lines';end if;return new;
end $$;
create constraint trigger journal_balance_at_commit after insert on tenant_journals deferrable initially deferred for each row execute function tenant_require_balanced_journal();
create constraint trigger journal_line_balance_at_commit after insert on tenant_journal_lines deferrable initially deferred for each row execute function tenant_require_balanced_journal();
revoke all on function tenant_require_balanced_journal() from public,anon,authenticated;

create function tenant_finance_line(p_code text,p_debit bigint,p_credit bigint) returns jsonb language sql immutable as $$select jsonb_build_object('account',p_code,'debit',p_debit,'credit',p_credit)$$;
create function tenant_finance_post(p_company uuid,p_source text,p_id text,p_date date,p_warehouse text,p_description text,p_lines jsonb,p_meta jsonb default '{}') returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior tenant_journals;fingerprint text;jid uuid;period uuid;line jsonb;n integer:=0;debits bigint:=0;credits bigint:=0;dr bigint;cr bigint;chosen_code text;begin
 if p_source is null or length(p_source)>60 or p_id is null or length(p_id)>160 or p_date is null or length(trim(coalesce(p_description,''))) not between 5 and 500 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 2 and 200 then raise exception 'Invalid journal';end if;
 fingerprint=md5(jsonb_build_array(p_date,p_warehouse,p_description,p_lines,p_meta)::text);
 perform pg_advisory_xact_lock(hashtextextended('journal:'||p_company::text||p_source||p_id,0));
 select * into prior from tenant_journals where company_id=p_company and source_kind=p_source and source_id=p_id;
 if found then if prior.fingerprint<>fingerprint then raise exception 'Journal source already posted with different details';end if;return prior.id;end if;
 -- Existing periods permit concurrent source postings; closing remains an
 -- exclusive lock. First creation takes the exclusive lock directly, avoiding
 -- a shared-to-exclusive lock upgrade between concurrent first postings.
 if exists(select 1 from tenant_accounting_periods where company_id=p_company and starts_on=date_trunc('month',p_date)::date) then
  perform pg_advisory_xact_lock_shared(hashtextextended('period:'||p_company::text||date_trunc('month',p_date)::date::text,0));
 else perform pg_advisory_xact_lock(hashtextextended('period:'||p_company::text||date_trunc('month',p_date)::date::text,0));end if;
 select id into period from tenant_accounting_periods where company_id=p_company and starts_on<=p_date and ends_on>=p_date and closed_at is null;
 if not found then
  if exists(select 1 from tenant_accounting_periods where company_id=p_company and starts_on<=p_date and ends_on>=p_date) then raise exception 'Accounting period is closed';end if;
  insert into tenant_accounting_periods(company_id,starts_on,ends_on) values(p_company,date_trunc('month',p_date)::date,(date_trunc('month',p_date)+interval '1 month - 1 day')::date) returning id into period;
 end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if coalesce(line->>'debit','')!~'^[0-9]{1,15}$' or coalesce(line->>'credit','')!~'^[0-9]{1,15}$' then raise exception 'Journal money must be exact nonnegative kobo';end if;
  dr=(line->>'debit')::bigint;cr=(line->>'credit')::bigint;chosen_code=line->>'account';
  if dr<0 or cr<0 or dr>100000000000000 or cr>100000000000000 or not((dr>0 and cr=0) or(cr>0 and dr=0)) or not exists(select 1 from tenant_accounts where company_id=p_company and tenant_accounts.code=chosen_code and active) then raise exception 'Invalid account or journal amount';end if;
  debits=debits+dr;credits=credits+cr;
 end loop;
 if debits<>credits then raise exception 'Debits and credits must balance';end if;
 insert into tenant_journals(company_id,entry_date,period_id,warehouse_id,source_kind,source_id,command_id,description,fingerprint,actor,reverses_id,flow,metadata)
 values(p_company,p_date,period,p_warehouse,p_source,p_id,(p_meta->>'command_id')::uuid,trim(p_description),fingerprint,auth.uid(),(p_meta->>'reverses_id')::uuid,coalesce(p_meta->>'flow','operating'),p_meta) returning id into jid;
 for line in select value from jsonb_array_elements(p_lines) loop n=n+1;insert into tenant_journal_lines values(p_company,jid,n,line->>'account',(line->>'debit')::bigint,(line->>'credit')::bigint);end loop;
 return jid;
end $$;

create function tenant_finance_ensure(p_company uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare location record;inventory_value bigint;receivables bigint;lines jsonb;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 if exists(select 1 from tenant_finance_config where company_id=p_company) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-init:'||p_company::text,0));
 if exists(select 1 from tenant_finance_config where company_id=p_company) then return;end if;
 insert into tenant_finance_config(company_id) values(p_company);
 insert into tenant_accounts(company_id,code,name,kind,subtype,system) select p_company,code,name,kind,subtype,true from(values
 ('1000','Cash on hand','asset','cash'),('1010','Bank account','asset','bank'),('1020','Terminal clearing','asset','clearing'),('1030','Online provider clearing','asset','clearing'),
 ('1100','Customer receivables','asset','receivable'),('1110','Affiliate receivables','asset','receivable'),('1200','Warehouse inventory at recorded cost','asset','inventory'),('1210','Quarantined inventory','asset','inventory'),('1220','Inventory in transit','asset','inventory'),('1230','Inventory in partner custody','asset','inventory'),('1290','Interbranch transfer clearing','asset','interbranch'),('2000','Supplier payables','liability','payable'),('2100','Sales tax payable','liability','tax'),('2200','Commission payable','liability','commission'),
 ('2300','Goods received not invoiced','liability','received_unbilled'),('3000','Opening balances','equity','opening'),('4000','Sales revenue','revenue','sales'),('4010','Delivery revenue','revenue','delivery'),('4100','Sales returns','revenue','returns'),('4200','Inventory adjustment gains','revenue','adjustment'),
 ('5000','Cost of goods sold','cost_of_sales','cogs'),('5100','Stock write-offs','expense','stock'),('6000','Operating expenses','expense','operating'),('6100','Commissions','expense','commission'),('6200','Payroll','expense','payroll'),('6300','Payment and bank fees','expense','fees')
 )a(code,name,kind,subtype);
 -- Establish opening inventory and AR from canonical operational balances.
 -- Historical revenue/cash are not invented or re-recognized as current profit.
 for location in select id from warehouses where company_id=p_company order by id loop
  select coalesce(sum(i.on_hand*p.cost_kobo),0) into inventory_value from tenant_inventory i join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=p_company and i.warehouse_id=location.id;
  select coalesce(sum(greatest(0,total_kobo-returned_kobo-paid_kobo)),0) into receivables from pos_sales where company_id=p_company and warehouse_id=location.id;
  lines='[]';if inventory_value>0 then lines=lines||jsonb_build_array(tenant_finance_line('1200',inventory_value,0));end if;
  if receivables>0 then lines=lines||jsonb_build_array(tenant_finance_line('1100',receivables,0));end if;
  if inventory_value+receivables>0 then
   lines=lines||jsonb_build_array(tenant_finance_line('3000',0,inventory_value+receivables));
   perform tenant_finance_post(p_company,'opening',location.id,today,location.id,'Opening recorded inventory and customer receivables',lines,jsonb_build_object('flow','opening','valuation','recorded_standard_cost','historical_revenue_imported',false));
  end if;
 end loop;
end $$;

create function tenant_finance_pos_event(p_company uuid,p_key uuid,p_action text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare sale pos_sales;receipt tenant_business_commands;return_record tenant_pos_returns;lines jsonb:='[]';t record;r record;paid bigint:=0;cost bigint:=0;tax_credit bigint:=0;part_tax bigint;previous_tax bigint;cumulative_qty integer;resellable_cost bigint:=0;damaged_cost bigint:=0;account text;jid uuid;begin
 if exists(select 1 from tenant_journals where company_id=p_company and source_kind='pos.'||p_action and source_id=p_key::text) then return;end if;
 select * into receipt from tenant_business_commands where company_id=p_company and id=p_key;
 select * into sale from pos_sales where company_id=p_company and id=case when p_action='sale' then p_key else(receipt.payload->>'sale_id')::uuid end;
 if p_action in ('sale','payment') then
  for t in select id,method,amount_kobo amount from tenant_pos_tenders where company_id=p_company and command_id=p_key order by id loop
   account=case t.method when 'cash' then '1000' when 'bank_transfer' then '1010' else '1020' end;paid=paid+t.amount;lines=lines||jsonb_build_array(tenant_finance_line(account,t.amount,0));
  end loop;
  if p_action='sale' then
   if sale.total_kobo>paid then lines=lines||jsonb_build_array(tenant_finance_line('1100',sale.total_kobo-paid,0));end if;
   lines=lines||jsonb_build_array(tenant_finance_line('4000',0,sale.total_kobo-sale.tax_kobo));
   if sale.tax_kobo>0 then lines=lines||jsonb_build_array(tenant_finance_line('2100',0,sale.tax_kobo));end if;
   select coalesce(sum(unit_cost_kobo*quantity),0) into cost from pos_items where company_id=p_company and sale_id=sale.id;
   if cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5000',cost,0),tenant_finance_line('1200',0,cost));end if;
  else lines=lines||jsonb_build_array(tenant_finance_line('1100',0,paid));end if;
 else
  select * into return_record from tenant_pos_returns where company_id=p_company and id=p_key;
  for r in select ri.*,i.quantity sold,i.tax_kobo original_tax,i.unit_cost_kobo from tenant_pos_return_items ri join pos_items i on i.company_id=ri.company_id and i.id=ri.item_id where ri.company_id=p_company and ri.return_id=p_key loop
   select coalesce(sum(tax_kobo),0) into previous_tax from tenant_return_accounting where company_id=p_company and item_id=r.item_id;
   select sum(quantity) into cumulative_qty from tenant_pos_return_items where company_id=p_company and item_id=r.item_id;
   part_tax=r.original_tax*cumulative_qty/r.sold-previous_tax;tax_credit=tax_credit+part_tax;
   insert into tenant_return_accounting values(p_company,p_key,r.item_id,part_tax);
   if r.disposition='resellable' then resellable_cost=resellable_cost+r.quantity*r.unit_cost_kobo;else damaged_cost=damaged_cost+r.quantity*r.unit_cost_kobo;end if;
  end loop;
  if return_record.amount_kobo>tax_credit then lines=lines||jsonb_build_array(tenant_finance_line('4100',return_record.amount_kobo-tax_credit,0));end if;
  if tax_credit>0 then lines=lines||jsonb_build_array(tenant_finance_line('2100',tax_credit,0));end if;
  if return_record.amount_kobo>return_record.refund_kobo then lines=lines||jsonb_build_array(tenant_finance_line('1100',0,return_record.amount_kobo-return_record.refund_kobo));end if;
  if return_record.refund_kobo>0 then lines=lines||jsonb_build_array(tenant_finance_line(case return_record.refund_method when 'cash' then '1000' when 'bank_transfer' then '1010' else '1020' end,0,return_record.refund_kobo));end if;
  if resellable_cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('1200',resellable_cost,0),tenant_finance_line('5000',0,resellable_cost));end if;
  if damaged_cost>0 then lines=lines||jsonb_build_array(tenant_finance_line('5100',damaged_cost,0),tenant_finance_line('5000',0,damaged_cost));end if;
 end if;
 jid=tenant_finance_post(p_company,'pos.'||p_action,p_key::text,(now() at time zone 'Africa/Lagos')::date,sale.warehouse_id,'POS '||p_action||' · '||sale.reference,lines,jsonb_build_object('command_id',p_key,'sale_id',sale.id,'verification','staff_confirmed','valuation','recorded_standard_cost'));
end $$;

alter function tenant_pos_command(uuid,uuid,text,jsonb) rename to tenant_pos_command_before_finance;
revoke all on function tenant_pos_command_before_finance(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function tenant_pos_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare result jsonb;rule tenant_pos_settings;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_action in ('sale','payment','return') then perform tenant_finance_ensure(p_company);end if;
 result=tenant_pos_command_before_finance(p_company,p_key,p_action,p_data);
 if p_action in ('sale','payment','return') then perform tenant_finance_pos_event(p_company,p_key,p_action);end if;
 if p_action='tax' then select * into rule from tenant_pos_settings where company_id=p_company;insert into tenant_pos_tax_versions(company_id,version,tax_bps,label,command_id) values(p_company,rule.version,rule.tax_bps,rule.tax_label,p_key) on conflict(company_id,version) do nothing;end if;
 return result;
end $$;
alter function tenant_pos_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_pos_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_pos_command(uuid,uuid,text,jsonb) to authenticated;

-- Stock quantity and cost changes generate accounting only after the opening
-- balances are established, in the same transaction as the operational change.
alter function tenant_business_command(uuid,uuid,text,jsonb) rename to tenant_business_command_before_finance;
revoke all on function tenant_business_command_before_finance(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function tenant_business_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare result jsonb;amount bigint;old_cost bigint;new_cost bigint;loc record;lines jsonb;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 if exists(select 1 from tenant_business_commands where company_id=p_company and id=p_key) then return tenant_business_command_before_finance(p_company,p_key,p_action,p_data);end if;
 if p_action='stock' and (coalesce(p_data->>'classification','count') not in ('count','opening','received_unbilled') or ((p_data->>'delta')::integer<0 and coalesce(p_data->>'classification','count')<>'count')) then raise exception 'Choose a valid stock classification; reductions require a physical count adjustment';end if;
 if p_action='stock' and p_data->>'classification'='opening' then perform tenant_assert(p_company,'finance.manage',null,p_data->>'warehouse_id');end if;
 if p_action in ('stock','product-master') then
  perform tenant_finance_ensure(p_company);
  perform 1 from products where company_id=p_company and id=coalesce(p_data->>'product_id',p_data->>'id') for update;
 end if;
 if p_action='product-master' then select cost_kobo into old_cost from products where company_id=p_company and id=p_data->>'id';end if;
 result=tenant_business_command_before_finance(p_company,p_key,p_action,p_data);
 if p_action='stock' then
  select cost_kobo*(p_data->>'delta')::bigint into amount from products where company_id=p_company and id=p_data->>'product_id';
  if coalesce(amount,0)<>0 then
   lines=case when amount>0 then jsonb_build_array(tenant_finance_line('1200',amount,0),tenant_finance_line(case coalesce(p_data->>'classification','count') when 'opening' then '3000' when 'received_unbilled' then '2300' else '4200' end,0,amount)) else jsonb_build_array(tenant_finance_line('5100',-amount,0),tenant_finance_line('1200',0,-amount)) end;
   perform tenant_finance_post(p_company,'stock',p_key::text,(now() at time zone 'Africa/Lagos')::date,p_data->>'warehouse_id',left('Stock adjustment · '||(p_data->>'reason'),500),lines,jsonb_build_object('command_id',p_key,'classification',coalesce(p_data->>'classification','count'),'flow',case when p_data->>'classification'='opening' then 'opening' else 'noncash' end,'valuation','recorded_standard_cost'));
  end if;
 elsif p_action='product-master' then
  new_cost=(p_data->>'cost_kobo')::bigint;
  if old_cost is distinct from new_cost then
   insert into tenant_product_cost_history(company_id,product_id,previous_kobo,new_kobo,actor) values(p_company,p_data->>'id',old_cost,new_cost,auth.uid());
   for loc in select warehouse_id,on_hand from tenant_inventory where company_id=p_company and product_id=p_data->>'id' and on_hand>0 order by warehouse_id loop
    amount=(new_cost-old_cost)*loc.on_hand;if amount<>0 then
     lines=case when amount>0 then jsonb_build_array(tenant_finance_line('1200',amount,0),tenant_finance_line(case when old_cost=0 then '3000' else '4200' end,0,amount)) else jsonb_build_array(tenant_finance_line('5100',-amount,0),tenant_finance_line('1200',0,-amount)) end;
     perform tenant_finance_post(p_company,'cost-revaluation',p_key::text||':'||loc.warehouse_id,(now() at time zone 'Africa/Lagos')::date,loc.warehouse_id,'Recorded unit-cost revaluation',lines,jsonb_build_object('command_id',p_key,'flow','noncash','valuation','recorded_standard_cost'));
    end if;
   end loop;
  end if;
 end if;return result;
end $$;
alter function tenant_business_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_business_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_business_command(uuid,uuid,text,jsonb) to authenticated;

-- Keep old clients working while routing their stock mutation through the same
-- accounting transaction. Such clients should supply a key for replay safety.
alter function tenant_commerce_command(uuid,text,jsonb) rename to tenant_commerce_command_before_finance;
revoke all on function tenant_commerce_command_before_finance(uuid,text,jsonb) from public,anon,authenticated;
create function tenant_commerce_command(p_company uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$ begin
 if p_action='stock' then return tenant_business_command(p_company,coalesce((p_data->>'key')::uuid,gen_random_uuid()),'stock',p_data);end if;
 return tenant_commerce_command_before_finance(p_company,p_action,p_data);
end $$;
alter function tenant_commerce_command(uuid,text,jsonb) owner to edge_tenant_executor;
revoke all on function tenant_commerce_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function tenant_commerce_command(uuid,text,jsonb) to authenticated;

revoke all on function tenant_finance_line(text,bigint,bigint),tenant_finance_post(uuid,text,text,date,text,text,jsonb,jsonb),tenant_finance_ensure(uuid),tenant_finance_pos_event(uuid,uuid,text) from public,anon,authenticated;
grant execute on function tenant_finance_line(text,bigint,bigint),tenant_finance_post(uuid,text,text,date,text,text,jsonb,jsonb),tenant_finance_ensure(uuid),tenant_finance_pos_event(uuid,uuid,text) to edge_tenant_executor;
