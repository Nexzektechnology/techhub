create table tenant_expenses(company_id uuid not null,id uuid not null,warehouse_id text,account_code text not null,payment_account text not null,amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),expense_date date not null,description text not null,reference text not null,journal_id uuid not null,created_by uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,account_code) references tenant_accounts(company_id,code),foreign key(company_id,payment_account) references tenant_accounts(company_id,code),foreign key(company_id,journal_id) references tenant_journals(company_id,id));
create table tenant_supplier_bills(company_id uuid not null,id uuid not null,supplier_id text not null,warehouse_id text,reference text not null,amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),paid_kobo bigint not null default 0 check(paid_kobo between 0 and amount_kobo),bill_date date not null,due_date date not null,description text not null,journal_id uuid not null,created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,supplier_id) references suppliers(company_id,id),foreign key(company_id,warehouse_id) references warehouses(company_id,id),foreign key(company_id,journal_id) references tenant_journals(company_id,id));
create unique index tenant_bill_reference on tenant_supplier_bills(company_id,supplier_id,lower(reference));
create index tenant_bill_due on tenant_supplier_bills(company_id,due_date) where paid_kobo<amount_kobo;
create table tenant_supplier_payments(company_id uuid not null,id uuid not null,bill_id uuid not null,account_code text not null,amount_kobo bigint not null check(amount_kobo>0),reference text not null,journal_id uuid not null,actor uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,bill_id) references tenant_supplier_bills(company_id,id),foreign key(company_id,account_code) references tenant_accounts(company_id,code),foreign key(company_id,journal_id) references tenant_journals(company_id,id));
create table tenant_cash_events(company_id uuid not null,id uuid not null default gen_random_uuid(),journal_id uuid not null,line_no integer not null,source_kind text not null,source_id text not null,account_code text not null,amount_kobo bigint not null check(amount_kobo<>0),reference text not null,actor uuid references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,journal_id,line_no) references tenant_journal_lines(company_id,journal_id,line_no),unique(company_id,source_kind,source_id));
create index tenant_cash_external_reference on tenant_cash_events(company_id,account_code,lower(reference),(amount_kobo>0)) where account_code<>'1000' and length(reference)>0;
create function tenant_cash_reference_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if new.account_code<>'1000' and length(new.reference)>0 then
  perform pg_advisory_xact_lock(hashtextextended('cash-reference:'||new.company_id::text||new.account_code||lower(new.reference)||(new.amount_kobo>0)::text,0));
  if exists(select 1 from tenant_cash_events e where e.company_id=new.company_id and e.account_code=new.account_code and lower(e.reference)=lower(new.reference) and(e.amount_kobo>0)=(new.amount_kobo>0) and not exists(select 1 from tenant_journals j where j.company_id=e.company_id and j.reverses_id=e.journal_id)) then raise exception 'Payment reference already recorded for this account and direction';end if;
 end if;return new;
end $$;
create trigger cash_reference_guard before insert on tenant_cash_events for each row execute function tenant_cash_reference_guard();
revoke all on function tenant_cash_reference_guard() from public,anon,authenticated;
create table tenant_bank_lines(company_id uuid not null,id uuid not null default gen_random_uuid(),account_code text not null,external_id text not null,entry_date date not null,amount_kobo bigint not null check(amount_kobo<>0),reference text not null,description text not null,import_command uuid not null,matched_event uuid,created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,account_code) references tenant_accounts(company_id,code),foreign key(company_id,matched_event) references tenant_cash_events(company_id,id),foreign key(company_id,import_command) references tenant_business_commands(company_id,id) deferrable initially deferred,unique(company_id,account_code,external_id));
create unique index tenant_bank_one_match on tenant_bank_lines(company_id,matched_event) where matched_event is not null;
create index tenant_bank_unmatched on tenant_bank_lines(company_id,account_code,entry_date) where matched_event is null;
create table tenant_bank_match_events(company_id uuid not null,id uuid not null,line_id uuid not null,event_id uuid,action text not null check(action in ('match','unmatch')),reason text not null,actor uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(company_id,id),foreign key(company_id,line_id) references tenant_bank_lines(company_id,id),foreign key(company_id,event_id) references tenant_cash_events(company_id,id));
alter table tenant_pos_tenders alter column session_id drop not null;
alter table tenant_pos_tenders add column ledger_account text;
alter table tenant_pos_tenders add constraint tender_ledger_account foreign key(company_id,ledger_account) references tenant_accounts(company_id,code);
do $$ declare t text;begin
 foreach t in array array['tenant_expenses','tenant_supplier_bills','tenant_supplier_payments','tenant_cash_events','tenant_bank_lines','tenant_bank_match_events'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);
  execute format('create policy tenant_company_boundary on %I as restrictive for all using(tenant_row_boundary(company_id)) with check(tenant_row_boundary(company_id))',t);
  execute format('create policy tenant_executor_access on %I for all to edge_tenant_executor using(true) with check(true)',t);
  execute format('grant select,insert,update,delete on %I to edge_tenant_executor',t);
 end loop;
 foreach t in array array['tenant_expenses','tenant_supplier_payments','tenant_cash_events','tenant_bank_match_events'] loop execute format('create trigger immutable_posted_evidence before update or delete on %I for each row execute function business_immutable_evidence()',t);end loop;
end $$;
alter table tenant_business_commands drop constraint tenant_business_commands_action_check;
alter table tenant_business_commands add constraint tenant_business_commands_action_check check(action in ('customer','supplier','product-master','stock','pos.register','pos.open','pos.close','pos.sale','pos.payment','pos.return','pos.hold','pos.credit','pos.tax') or action~'^finance[.](setup|account|manual|reverse|period|expense|bill|pay|collect|bank-import|bank-match|bank-unmatch|transfer)$');

create function tenant_finance_cash_event(p_company uuid,p_journal uuid,p_line integer,p_kind text,p_source text,p_account text,p_amount bigint,p_reference text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$ begin
 insert into tenant_cash_events(company_id,journal_id,line_no,source_kind,source_id,account_code,amount_kobo,reference,actor) values(p_company,p_journal,p_line,p_kind,p_source,p_account,p_amount,p_reference,auth.uid()) on conflict(company_id,source_kind,source_id) do nothing;
end $$;

-- Source receipt rows remain immutable. Their cash events link directly to a
-- journal line, allowing one statement item to match one actual cash event.
alter function tenant_finance_pos_event(uuid,uuid,text) rename to tenant_finance_pos_event_before_cash;
create function tenant_finance_pos_event(p_company uuid,p_key uuid,p_action text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare journal uuid;r record;n integer:=0;account text;return_record tenant_pos_returns;begin
 perform tenant_finance_pos_event_before_cash(p_company,p_key,p_action);
 select id into journal from tenant_journals where company_id=p_company and source_kind='pos.'||p_action and source_id=p_key::text;
 if p_action in ('sale','payment') then
  for r in select * from tenant_pos_tenders where company_id=p_company and command_id=p_key order by id loop
   n=n+1;account=case r.method when 'cash' then '1000' when 'bank_transfer' then '1010' else '1020' end;
   perform tenant_finance_cash_event(p_company,journal,n,'pos.tender',r.id::text,account,r.amount_kobo,r.reference);
  end loop;
 else
  select * into return_record from tenant_pos_returns where company_id=p_company and id=p_key;
  if return_record.refund_kobo>0 then
   account=case return_record.refund_method when 'cash' then '1000' when 'bank_transfer' then '1010' else '1020' end;
   select line_no into n from tenant_journal_lines where company_id=p_company and journal_id=journal and account_code=account and credit_kobo=return_record.refund_kobo;
   perform tenant_finance_cash_event(p_company,journal,n,'pos.refund',p_key::text,account,-return_record.refund_kobo,(select payload->>'reference' from tenant_business_commands where company_id=p_company and id=p_key));
  end if;
 end if;
end $$;

create function tenant_finance_command(p_company uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare prior tenant_business_commands;result jsonb;wid text;journal uuid;other_journal tenant_journals;bill tenant_supplier_bills;bank_line tenant_bank_lines;cash_event tenant_cash_events;sale pos_sales;tender_id uuid;
 lines jsonb;line jsonb;amount bigint;account text;target_account text;entry_date date;description text;reference text;period tenant_accounting_periods;row_data jsonb;duplicates integer:=0;inserted integer:=0;account_row tenant_accounts;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 if p_key is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>256000 or p_action is null or p_action not in ('setup','account','manual','reverse','period','expense','bill','pay','collect','bank-import','bank-match','bank-unmatch','transfer') then raise exception 'Invalid finance command';end if;
 perform set_config('app.tenant_id',p_company::text,true);wid=nullif(p_data->>'warehouse_id','');
 if p_action='pay' then select * into bill from tenant_supplier_bills where company_id=p_company and id=(p_data->>'bill_id')::uuid;if not found then raise exception 'Supplier bill unavailable';end if;wid=bill.warehouse_id;end if;
 if p_action='reverse' then select * into other_journal from tenant_journals where company_id=p_company and id=(p_data->>'journal_id')::uuid;if not found then raise exception 'Journal unavailable';end if;wid=other_journal.warehouse_id;end if;
 if p_action='collect' then select * into sale from pos_sales where company_id=p_company and id=(p_data->>'sale_id')::uuid;if not found then raise exception 'Customer invoice unavailable';end if;wid=sale.warehouse_id;end if;
 if p_action in ('setup','account','period','bank-import','bank-match','bank-unmatch','transfer') then perform tenant_assert(p_company,'finance.manage');else perform tenant_assert(p_company,'finance.manage',null,wid);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_key::text,0));
 select * into prior from tenant_business_commands where company_id=p_company and id=p_key;
 if found then if prior.actor<>auth.uid() or prior.action<>'finance.'||p_action or prior.payload<>p_data then raise exception 'Idempotency key already used with different input';end if;return prior.result;end if;
 perform tenant_finance_ensure(p_company);
 if p_action='setup' then result=jsonb_build_object('ready',true);
 elsif p_action='account' then
  if coalesce(p_data->>'code','')!~'^[0-9]{4,10}$' or length(trim(coalesce(p_data->>'name',''))) not between 2 and 100 or coalesce(p_data->>'kind','') not in ('asset','liability','equity','revenue','cost_of_sales','expense') or length(coalesce(p_data->>'subtype',''))>40 then raise exception 'Invalid ledger account';end if;
  select * into account_row from tenant_accounts where company_id=p_company and code=p_data->>'code';
  if found then if account_row.kind<>p_data->>'kind' or account_row.subtype<>coalesce(p_data->>'subtype','') then raise exception 'Account classification is immutable; create a new account';end if;update tenant_accounts set name=trim(p_data->>'name') where company_id=p_company and code=account_row.code;
  else insert into tenant_accounts(company_id,code,name,kind,subtype) values(p_company,p_data->>'code',trim(p_data->>'name'),p_data->>'kind',coalesce(p_data->>'subtype',''));end if;result=jsonb_build_object('code',p_data->>'code');
 elsif p_action='period' then
  select * into period from tenant_accounting_periods where company_id=p_company and id=(p_data->>'period_id')::uuid;if not found then raise exception 'Period unavailable';end if;
  perform pg_advisory_xact_lock(hashtextextended('period:'||p_company::text||period.starts_on::text,0));
  if length(trim(coalesce(p_data->>'reason',''))) not between 10 and 500 or jsonb_typeof(p_data->'closed') is distinct from 'boolean' then raise exception 'Confirm the period state and reason';end if;
  update tenant_accounting_periods set closed_at=case when(p_data->>'closed')::boolean then now() end,closed_by=case when(p_data->>'closed')::boolean then auth.uid() end where company_id=p_company and id=period.id;result=jsonb_build_object('id',period.id);
 elsif p_action in ('bank-import','bank-match','bank-unmatch') then
  if p_action='bank-import' then
   account=p_data->>'account_code';if not exists(select 1 from tenant_accounts where company_id=p_company and code=account and kind='asset' and subtype='bank') then raise exception 'Choose a bank ledger account';end if;
   if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception 'Import 1 to 500 statement rows';end if;
   for row_data in select value from jsonb_array_elements(p_data->'rows') loop
    if length(coalesce(row_data->>'external_id','')) not between 1 and 160 or coalesce(row_data->>'amount_kobo','')!~'^-?[0-9]{1,12}$' or(row_data->>'amount_kobo')::bigint=0 or length(coalesce(row_data->>'reference',''))>160 or length(coalesce(row_data->>'description',''))>500 then raise exception 'Invalid statement row';end if;
    if exists(select 1 from tenant_bank_lines where company_id=p_company and account_code=account and external_id=row_data->>'external_id') then
     if exists(select 1 from tenant_bank_lines existing_line where existing_line.company_id=p_company and existing_line.account_code=account and existing_line.external_id=row_data->>'external_id' and(existing_line.entry_date<>(row_data->>'date')::date or existing_line.amount_kobo<>(row_data->>'amount_kobo')::bigint or existing_line.reference<>coalesce(row_data->>'reference',''))) then raise exception 'Statement identity reused with changed data';end if;duplicates=duplicates+1;
    else insert into tenant_bank_lines(company_id,account_code,external_id,entry_date,amount_kobo,reference,description,import_command) values(p_company,account,row_data->>'external_id',(row_data->>'date')::date,(row_data->>'amount_kobo')::bigint,coalesce(row_data->>'reference',''),coalesce(row_data->>'description',''),p_key);inserted=inserted+1;end if;
   end loop;result=jsonb_build_object('inserted',inserted,'duplicates',duplicates);
  else
   select * into bank_line from tenant_bank_lines where company_id=p_company and id=(p_data->>'line_id')::uuid for update;if not found then raise exception 'Statement row unavailable';end if;
   if length(trim(coalesce(p_data->>'reason',''))) not between 10 and 500 then raise exception 'Record the reconciliation reason';end if;
   if p_action='bank-match' then
    if bank_line.matched_event is not null then raise exception 'Statement row already matched';end if;
    select * into cash_event from tenant_cash_events where company_id=p_company and id=(p_data->>'event_id')::uuid for update;
    if not found or cash_event.account_code<>bank_line.account_code or cash_event.amount_kobo<>bank_line.amount_kobo then raise exception 'Account, direction and amount must match';end if;
    if exists(select 1 from tenant_journals where company_id=p_company and reverses_id=cash_event.journal_id) then raise exception 'The source journal was reversed';end if;
    update tenant_bank_lines set matched_event=cash_event.id where company_id=p_company and id=bank_line.id;
    insert into tenant_bank_match_events values(p_company,p_key,bank_line.id,cash_event.id,'match',trim(p_data->>'reason'),auth.uid(),now());
   else
    if bank_line.matched_event is null then raise exception 'Statement row is not matched';end if;
    insert into tenant_bank_match_events values(p_company,p_key,bank_line.id,bank_line.matched_event,'unmatch',trim(p_data->>'reason'),auth.uid(),now());
    update tenant_bank_lines set matched_event=null where company_id=p_company and id=bank_line.id;
   end if;result=jsonb_build_object('id',bank_line.id);
  end if;
 else
  entry_date=coalesce((p_data->>'date')::date,(now() at time zone 'Africa/Lagos')::date);description=trim(coalesce(p_data->>'description',''));reference=trim(coalesce(p_data->>'reference',''));
  if p_action='manual' then
   lines=p_data->'lines';if length(description) not between 10 and 500 or jsonb_typeof(lines) is distinct from 'array' then raise exception 'Describe the journal and provide balanced lines';end if;
   if exists(select 1 from jsonb_array_elements(lines) l join tenant_accounts a on a.company_id=p_company and a.code=l->>'account' where a.subtype in ('receivable','payable','inventory','tax','commission','interbranch')) then raise exception 'Use the source workflow for receivables, payables, inventory or tax';end if;
   journal=tenant_finance_post(p_company,'manual',p_key::text,entry_date,wid,description,lines,jsonb_build_object('command_id',p_key,'flow',coalesce(p_data->>'flow','operating')));
  elsif p_action='reverse' then
   if other_journal.source_kind not in ('manual','expense','transfer') then raise exception 'Use the original sale, return, purchasing or payment workflow to correct this source';end if;
   if length(description) not between 10 and 500 then raise exception 'Record the reversal reason';end if;
   if exists(select 1 from tenant_bank_lines bl join tenant_cash_events ce on ce.company_id=bl.company_id and ce.id=bl.matched_event where bl.company_id=p_company and ce.journal_id=other_journal.id) then raise exception 'Unmatch the bank statement with a reason before reversing this entry';end if;
   select jsonb_agg(tenant_finance_line(account_code,credit_kobo,debit_kobo) order by line_no) into lines from tenant_journal_lines where company_id=p_company and journal_id=other_journal.id;
   journal=tenant_finance_post(p_company,'reversal',p_key::text,entry_date,wid,description,lines,jsonb_build_object('command_id',p_key,'reverses_id',other_journal.id,'flow',other_journal.flow));
  else
   if coalesce(p_data->>'amount_kobo','')!~'^[0-9]{1,12}$' or(p_data->>'amount_kobo')::bigint not between 1 and 100000000000 or length(reference) not between 6 and 160 then raise exception 'Record a valid amount and actual transaction reference';end if;
   amount=(p_data->>'amount_kobo')::bigint;account=p_data->>'account_code';target_account=p_data->>'payment_account';
   if p_action in ('expense','pay','collect','transfer') then
    if p_data->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm the funds actually moved';end if;
    if not exists(select 1 from tenant_accounts where company_id=p_company and code=target_account and active and kind='asset' and subtype in ('cash','bank','clearing')) then raise exception 'Choose an active cash or bank account';end if;
   end if;
   if p_action in ('expense','bill') then
    if length(description) not between 5 and 500 or not exists(select 1 from tenant_accounts where company_id=p_company and code=account and active and kind='expense') then raise exception 'Choose an expense account and describe the transaction';end if;
   end if;
   if p_action='expense' then
    journal=tenant_finance_post(p_company,'expense',p_key::text,entry_date,wid,description,jsonb_build_array(tenant_finance_line(account,amount,0),tenant_finance_line(target_account,0,amount)),jsonb_build_object('command_id',p_key));
    insert into tenant_expenses values(p_company,p_key,wid,account,target_account,amount,entry_date,description,reference,journal,auth.uid(),now());
    perform tenant_finance_cash_event(p_company,journal,2,'expense',p_key::text,target_account,-amount,reference);
   elsif p_action='bill' then
    if not exists(select 1 from suppliers where company_id=p_company and id=p_data->>'supplier_id' and active) then raise exception 'Supplier unavailable';end if;
    journal=tenant_finance_post(p_company,'bill',p_key::text,entry_date,wid,description,jsonb_build_array(tenant_finance_line(account,amount,0),tenant_finance_line('2000',0,amount)),jsonb_build_object('command_id',p_key,'flow','noncash'));
    insert into tenant_supplier_bills(company_id,id,supplier_id,warehouse_id,reference,amount_kobo,bill_date,due_date,description,journal_id) values(p_company,p_key,p_data->>'supplier_id',wid,reference,amount,entry_date,(p_data->>'due_date')::date,description,journal);
   elsif p_action='pay' then
    select * into bill from tenant_supplier_bills where company_id=p_company and id=bill.id for update;
    if amount>bill.amount_kobo-bill.paid_kobo then raise exception 'Supplier payment exceeds the outstanding bill';end if;
    journal=tenant_finance_post(p_company,'supplier-payment',p_key::text,entry_date,wid,'Supplier payment · '||bill.reference,jsonb_build_array(tenant_finance_line('2000',amount,0),tenant_finance_line(target_account,0,amount)),jsonb_build_object('command_id',p_key,'bill_id',bill.id));
    insert into tenant_supplier_payments values(p_company,p_key,bill.id,target_account,amount,reference,journal,auth.uid(),now());update tenant_supplier_bills set paid_kobo=paid_kobo+amount where company_id=p_company and id=bill.id;
    perform tenant_finance_cash_event(p_company,journal,2,'supplier-payment',p_key::text,target_account,-amount,reference);
   elsif p_action='collect' then
    select * into sale from pos_sales where company_id=p_company and id=sale.id for update;
    if amount>sale.total_kobo-sale.returned_kobo-sale.paid_kobo then raise exception 'Customer payment exceeds the outstanding balance';end if;
    journal=tenant_finance_post(p_company,'customer-payment',p_key::text,entry_date,wid,'Customer payment · '||sale.reference,jsonb_build_array(tenant_finance_line(target_account,amount,0),tenant_finance_line('1100',0,amount)),jsonb_build_object('command_id',p_key,'sale_id',sale.id));
    insert into tenant_pos_tenders(company_id,sale_id,session_id,command_id,method,amount_kobo,tendered_kobo,reference,actor,ledger_account) values(p_company,sale.id,null,p_key,case when target_account='1000' then 'cash' else 'bank_transfer' end,amount,amount,reference,auth.uid(),target_account) returning id into tender_id;
    update pos_sales set paid_kobo=paid_kobo+amount where company_id=p_company and id=sale.id;perform tenant_pos_refresh(p_company,sale.id);
    perform tenant_finance_cash_event(p_company,journal,1,'pos.tender',tender_id::text,target_account,amount,reference);
   else
    if account=target_account or not exists(select 1 from tenant_accounts where company_id=p_company and code=account and active and kind='asset' and subtype in ('cash','bank','clearing')) then raise exception 'Choose two different cash or bank accounts';end if;
    journal=tenant_finance_post(p_company,'transfer',p_key::text,entry_date,null,case when length(description)>=5 then description else 'Internal account transfer' end,jsonb_build_array(tenant_finance_line(account,amount,0),tenant_finance_line(target_account,0,amount)),jsonb_build_object('command_id',p_key,'flow','noncash'));
    perform tenant_finance_cash_event(p_company,journal,1,'transfer.in',p_key::text,account,amount,reference);perform tenant_finance_cash_event(p_company,journal,2,'transfer.out',p_key::text,target_account,-amount,reference);
   end if;
  end if;result=jsonb_build_object('id',p_key,'journal_id',journal);
 end if;
 insert into tenant_business_commands(company_id,id,actor,action,payload,result) values(p_company,p_key,auth.uid(),'finance.'||p_action,p_data,result);
 perform platform_log(p_company,'finance.'||p_action,jsonb_build_object('command',p_key,'result',result));return result;
end $$;

create function tenant_finance_snapshot(p_company uuid,p_warehouse text default null,p_from date default null,p_to date default null,p_account text default '',p_page integer default 1,p_balance boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare starts date:=coalesce(p_from,date_trunc('month',now() at time zone 'Africa/Lagos')::date);ends date:=coalesce(p_to,(now() at time zone 'Africa/Lagos')::date);begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) or not tenant_any_permission(p_company,'finance.read') then raise exception 'Forbidden';end if;
 if starts>ends or ends-starts>366 or p_page is null or p_page not between 1 and 100000 or length(coalesce(p_account,''))>10 then raise exception 'Choose a valid reporting period of up to 366 days';end if;
 perform set_config('app.tenant_id',p_company::text,true);
 if p_warehouse is not null and not tenant_permission(p_company,'finance.read',null,p_warehouse) then raise exception 'Forbidden';end if;
 return jsonb_build_object('access',saas_access(p_company),'can_manage',tenant_permission(p_company,'finance.manage',null,p_warehouse),'can_admin',tenant_permission(p_company,'finance.manage'),'can_export',tenant_permission(p_company,'reports.read',null,p_warehouse),
 'can_pos',tenant_any_permission(p_company,'orders.read'),'can_affiliates',tenant_any_permission(p_company,'affiliates.read'),
 'cash_opening_kobo',(select coalesce(sum(l.debit_kobo-l.credit_kobo),0)::text from tenant_journal_lines l join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code where l.company_id=p_company and a.subtype in ('cash','bank') and j.entry_date<starts and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id)),
 'unvalued_stock_units',(select coalesce(sum(i.on_hand),0) from tenant_inventory i join products p on p.company_id=i.company_id and p.id=i.product_id where i.company_id=p_company and p.cost_kobo=0 and(p_warehouse is null or i.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,i.warehouse_id)),
 'coverage',(select to_jsonb(c) from tenant_finance_config c where company_id=p_company),'from',starts,'to',ends,
 'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from warehouses where company_id=p_company and tenant_permission(p_company,'finance.read',null,id)),'[]'),
 'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by code) from tenant_accounts a where company_id=p_company),'[]'),
 'trial_balance',coalesce((select jsonb_agg(to_jsonb(t) order by code) from(select a.code,a.name,a.kind,a.subtype,coalesce(sum(l.debit_kobo) filter(where j.id is not null),0)::text debit_kobo,coalesce(sum(l.credit_kobo) filter(where j.id is not null),0)::text credit_kobo,coalesce(sum(l.debit_kobo-l.credit_kobo) filter(where j.id is not null),0)::text balance_kobo from tenant_accounts a left join tenant_journal_lines l on l.company_id=a.company_id and l.account_code=a.code left join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id and j.entry_date<=ends and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) where a.company_id=p_company group by a.code,a.name,a.kind,a.subtype)t),'[]'),
 'profit_loss',coalesce((select jsonb_agg(to_jsonb(t) order by code) from(select a.code,a.name,a.kind,sum(l.debit_kobo-l.credit_kobo)::text balance_kobo from tenant_journal_lines l join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id where l.company_id=p_company and j.entry_date between starts and ends and a.kind in ('revenue','cost_of_sales','expense') and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) group by a.code,a.name,a.kind)t),'[]'),
 'uncosted_units',(select coalesce(sum(i.quantity),0) from pos_items i join pos_sales s on s.company_id=i.company_id and s.id=i.sale_id where i.company_id=p_company and i.unit_cost_kobo=0 and exists(select 1 from tenant_journals j where j.company_id=s.company_id and j.source_kind='pos.sale' and j.source_id=s.id::text and j.entry_date between starts and ends) and(p_warehouse is null or s.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,s.warehouse_id)),
 'journals',coalesce((select jsonb_agg(to_jsonb(j)) from(select j.*,coalesce((select jsonb_agg(jsonb_build_object('line_no',l.line_no,'account_code',l.account_code,'debit_kobo',l.debit_kobo::text,'credit_kobo',l.credit_kobo::text) order by l.line_no) from tenant_journal_lines l where l.company_id=j.company_id and l.journal_id=j.id),'[]') lines,(select r.id from tenant_journals r where r.company_id=j.company_id and r.reverses_id=j.id) reversed_by from tenant_journals j where j.company_id=p_company and j.entry_date<=ends and(p_balance or j.entry_date>=starts) and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) and(coalesce(p_account,'')='' or exists(select 1 from tenant_journal_lines l join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code where l.company_id=j.company_id and l.journal_id=j.id and(l.account_code=p_account or(p_account='inventory' and a.subtype='inventory') or(p_account='debt' and a.subtype='receivable') or(p_account='cash' and a.subtype in ('cash','bank')) or(p_account='revenue' and a.kind='revenue') or(p_account='profit' and a.kind in ('revenue','cost_of_sales','expense'))))) order by j.entry_date desc,j.created_at desc,j.id limit 25 offset(p_page-1)*25)j),'[]'),
 'journal_count',(select count(*) from tenant_journals j where j.company_id=p_company and j.entry_date<=ends and(p_balance or j.entry_date>=starts) and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) and(coalesce(p_account,'')='' or exists(select 1 from tenant_journal_lines l join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code where l.company_id=j.company_id and l.journal_id=j.id and(l.account_code=p_account or(p_account='inventory' and a.subtype='inventory') or(p_account='debt' and a.subtype='receivable') or(p_account='cash' and a.subtype in ('cash','bank')) or(p_account='revenue' and a.kind='revenue') or(p_account='profit' and a.kind in ('revenue','cost_of_sales','expense')))))),
 'receivables',coalesce((select jsonb_agg(to_jsonb(s)) from(select id,reference,warehouse_id,buyer,business_customer_id,due_date,(total_kobo-returned_kobo-paid_kobo)::text balance_kobo from pos_sales where company_id=p_company and total_kobo>returned_kobo+paid_kobo and(p_warehouse is null or warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,warehouse_id) order by due_date,id limit 25 offset(p_page-1)*25)s),'[]'),
 'bills',coalesce((select jsonb_agg(to_jsonb(b)) from(select b.*,s.name supplier_name,(b.amount_kobo-b.paid_kobo)::text balance_kobo from tenant_supplier_bills b join suppliers s on s.company_id=b.company_id and s.id=b.supplier_id where b.company_id=p_company and(p_warehouse is null or b.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,b.warehouse_id) order by b.due_date,b.id limit 25 offset(p_page-1)*25)b),'[]'),
 'suppliers',coalesce((select jsonb_agg(to_jsonb(s)) from(select id,name from suppliers where company_id=p_company and active order by name,id limit 100)s),'[]'),
 'periods',coalesce((select jsonb_agg(to_jsonb(p)) from(select * from tenant_accounting_periods where company_id=p_company order by starts_on desc limit 24)p),'[]'),
 'bank_lines',case when tenant_permission(p_company,'finance.read') then coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('amount_kobo',b.amount_kobo::text)) from(select * from tenant_bank_lines where company_id=p_company order by entry_date desc,id limit 50 offset(p_page-1)*50)b),'[]') else '[]' end,
 'cash_events',case when tenant_permission(p_company,'finance.read') then coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('amount_kobo',c.amount_kobo::text)) from(select c.* from tenant_cash_events c join tenant_journals j on j.company_id=c.company_id and j.id=c.journal_id where c.company_id=p_company and not exists(select 1 from tenant_bank_lines b where b.company_id=c.company_id and b.matched_event=c.id) and not exists(select 1 from tenant_journals r where r.company_id=j.company_id and r.reverses_id=j.id) order by c.created_at desc,c.id limit 100)c),'[]') else '[]' end,
 'cash_flow',coalesce((select jsonb_agg(to_jsonb(c)) from(select j.flow,a.code,a.name,sum(l.debit_kobo-l.credit_kobo)::text movement_kobo from tenant_journal_lines l join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code where l.company_id=p_company and a.subtype in ('cash','bank') and j.entry_date between starts and ends and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) group by j.flow,a.code,a.name)c),'[]'));
end $$;

alter function tenant_finance_command(uuid,uuid,text,jsonb) owner to edge_tenant_executor;
alter function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) owner to edge_tenant_executor;
revoke all on function tenant_finance_pos_event(uuid,uuid,text),tenant_finance_cash_event(uuid,uuid,integer,text,text,text,bigint,text),tenant_finance_command(uuid,uuid,text,jsonb),tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) from public,anon,authenticated;
grant execute on function tenant_finance_pos_event(uuid,uuid,text),tenant_finance_cash_event(uuid,uuid,integer,text,text,text,bigint,text) to edge_tenant_executor;
grant execute on function tenant_finance_command(uuid,uuid,text,jsonb),tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) to authenticated;

create function tenant_finance_journal(p_company uuid,p_journal uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$ declare entry tenant_journals;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);select * into entry from tenant_journals where company_id=p_company and id=p_journal;
 if not found or not tenant_permission(p_company,'finance.read',null,entry.warehouse_id) then raise exception 'Forbidden';end if;
 return to_jsonb(entry)||jsonb_build_object('reversed_by',(select id from tenant_journals where company_id=p_company and reverses_id=entry.id),'lines',(select jsonb_agg(jsonb_build_object('line_no',line_no,'account_code',account_code,'debit_kobo',debit_kobo::text,'credit_kobo',credit_kobo::text) order by line_no) from tenant_journal_lines where company_id=p_company and journal_id=entry.id));
end $$;
alter function tenant_finance_journal(uuid,uuid) owner to edge_tenant_executor;
revoke all on function tenant_finance_journal(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_finance_journal(uuid,uuid) to authenticated;

create function tenant_pos_get_sale(p_company uuid,p_sale uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$ declare wid text;begin
 if not tenant_verified_user() or company_role(p_company) is null or not tenant_commerce_enabled(p_company) then raise exception 'Forbidden';end if;
 perform set_config('app.tenant_id',p_company::text,true);select warehouse_id into wid from pos_sales where company_id=p_company and id=p_sale;
 if not found or not(tenant_permission(p_company,'orders.read',null,wid) or tenant_permission(p_company,'finance.read',null,wid)) then raise exception 'Forbidden';end if;
 return tenant_pos_sale_json(p_company,p_sale);
end $$;
alter function tenant_pos_get_sale(uuid,uuid) owner to edge_tenant_executor;
revoke all on function tenant_pos_get_sale(uuid,uuid) from public,anon,authenticated;
grant execute on function tenant_pos_get_sale(uuid,uuid) to authenticated;
