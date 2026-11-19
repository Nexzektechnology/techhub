-- Reporting retains operational scope and exports only explicitly authorized data.
alter function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) rename to tenant_finance_snapshot_before_reporting;
revoke all on function tenant_finance_snapshot_before_reporting(uuid,text,date,date,text,integer,boolean) from public,anon,authenticated;
create function tenant_finance_snapshot(p_company uuid,p_warehouse text default null,p_from date default null,p_to date default null,p_account text default '',p_page integer default 1,p_balance boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb; aging_ar jsonb;aging_ap jsonb;today date:=(now() at time zone 'Africa/Lagos')::date;begin
 snapshot=tenant_finance_snapshot_before_reporting(p_company,p_warehouse,p_from,p_to,p_account,p_page,p_balance);
 perform set_config('app.tenant_id',p_company::text,true);
 select coalesce(jsonb_object_agg(bucket,amount),'{}') into aging_ar from(
  select case when s.due_date is null or s.due_date>=today then 'current' when today-s.due_date<=30 then '1_30' when today-s.due_date<=60 then '31_60' when today-s.due_date<=90 then '61_90' else 'over_90' end bucket,sum(s.total_kobo-s.returned_kobo-s.paid_kobo)::text amount
  from pos_sales s where s.company_id=p_company and s.total_kobo>s.returned_kobo+s.paid_kobo and(p_warehouse is null or s.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,s.warehouse_id) group by 1)t;
 select coalesce(jsonb_object_agg(bucket,amount),'{}') into aging_ap from(
  select case when b.due_date>=today then 'current' when today-b.due_date<=30 then '1_30' when today-b.due_date<=60 then '31_60' when today-b.due_date<=90 then '61_90' else 'over_90' end bucket,sum(b.amount_kobo-b.paid_kobo)::text amount
  from tenant_supplier_bills b where b.company_id=p_company and b.amount_kobo>b.paid_kobo and(p_warehouse is null or b.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,b.warehouse_id) group by 1)t;
 return snapshot||jsonb_build_object('aging_date',today,'receivable_aging',aging_ar,'payable_aging',aging_ap,
 'receivable_count',(select count(*) from pos_sales s where s.company_id=p_company and s.total_kobo>s.returned_kobo+s.paid_kobo and(p_warehouse is null or s.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,s.warehouse_id)),
 'bill_count',(select count(*) from tenant_supplier_bills b where b.company_id=p_company and(p_warehouse is null or b.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,b.warehouse_id)),
 'bank_line_count',case when tenant_permission(p_company,'finance.read') then(select count(*) from tenant_bank_lines where company_id=p_company) else 0 end);
end $$;
alter function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) owner to edge_tenant_executor;
revoke all on function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) from public,anon,authenticated;
grant execute on function tenant_finance_snapshot(uuid,text,date,date,text,integer,boolean) to authenticated;

create function tenant_finance_export(p_company uuid,p_kind text,p_warehouse text default null,p_from date default null,p_to date default null,p_account text default '',p_balance boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set app.tenant_id='' as $$
declare snapshot jsonb;rows jsonb;starts date;ends date;row_count bigint;begin
 if not tenant_verified_user() or not tenant_permission(p_company,'reports.read',null,p_warehouse) then raise exception 'Forbidden';end if;
 if p_kind not in ('ledger','trial_balance','profit_loss','balance_sheet','cash_flow','receivables','payables') then raise exception 'Choose a supported financial report';end if;
 snapshot=tenant_finance_snapshot(p_company,p_warehouse,p_from,p_to,p_account,1,p_balance);
 starts=(snapshot->>'from')::date;ends=(snapshot->>'to')::date;perform set_config('app.tenant_id',p_company::text,true);
 if p_kind='ledger' then
  select count(*) into row_count from tenant_journal_lines l join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id where j.company_id=p_company and j.entry_date<=ends and(p_balance or j.entry_date>=starts) and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id);
  if row_count>10000 then raise exception 'Export exceeds 10000 ledger lines; choose a smaller period or location';end if;
  select coalesce(jsonb_agg(jsonb_build_array(j.entry_date,j.id,j.source_kind,j.source_id,j.warehouse_id,j.description,l.line_no,l.account_code,a.name,l.debit_kobo::text,l.credit_kobo::text) order by j.entry_date,j.created_at,j.id,l.line_no),'[]') into rows from tenant_journal_lines l join tenant_journals j on j.company_id=l.company_id and j.id=l.journal_id join tenant_accounts a on a.company_id=l.company_id and a.code=l.account_code where j.company_id=p_company and j.entry_date<=ends and(p_balance or j.entry_date>=starts) and(p_warehouse is null or j.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,j.warehouse_id) and(coalesce(p_account,'')='' or l.account_code=p_account or(p_account='inventory' and a.subtype='inventory') or(p_account='debt' and a.subtype='receivable') or(p_account='cash' and a.subtype in ('cash','bank')) or(p_account='revenue' and a.kind='revenue') or(p_account='profit' and a.kind in ('revenue','cost_of_sales','expense')));
  rows=jsonb_build_array(jsonb_build_array('Date','Journal ID','Source kind','Source ID','Warehouse','Description','Line','Account code','Account','Debit kobo','Credit kobo'))||rows;
 elsif p_kind='trial_balance' then
  select coalesce(jsonb_agg(jsonb_build_array(ends,r->>'code',r->>'name',r->>'kind',r->>'debit_kobo',r->>'credit_kobo',r->>'balance_kobo')),'[]') into rows from jsonb_array_elements(snapshot->'trial_balance')r;
  rows=jsonb_build_array(jsonb_build_array('As of','Account code','Account','Kind','Debits kobo','Credits kobo','Balance kobo (debit positive)'))||rows;
 elsif p_kind in ('balance_sheet','profit_loss') then
  select coalesce(jsonb_agg(jsonb_build_array(r->>'code',r->>'name',r->>'kind',case when p_kind='balance_sheet' and r->>'kind' in ('liability','equity') then (-(r->>'balance_kobo')::numeric)::text else r->>'balance_kobo' end)),'[]') into rows from jsonb_array_elements(snapshot->case when p_kind='profit_loss' then 'profit_loss' else 'trial_balance' end) r where p_kind<>'balance_sheet' or r->>'kind' in ('asset','liability','equity');
  if p_kind='balance_sheet' then rows=rows||jsonb_build_array(jsonb_build_array('','Retained earnings','equity',(select (-coalesce(sum((r->>'balance_kobo')::numeric),0))::text from jsonb_array_elements(snapshot->'trial_balance') r where r->>'kind' in ('revenue','cost_of_sales','expense'))));end if;
  rows=jsonb_build_array(jsonb_build_array('Account code','Account','Kind','Balance kobo (balance sheet: assets debit, liabilities/equity credit; profit/loss: debit positive)'))||rows;
 elsif p_kind='cash_flow' then
  select coalesce(jsonb_agg(jsonb_build_array(r->>'flow',r->>'code',r->>'name',r->>'movement_kobo')),'[]') into rows from jsonb_array_elements(snapshot->'cash_flow')r;
  rows=jsonb_build_array(jsonb_build_array('Flow','Account code','Account','Movement kobo'),jsonb_build_array('opening','','Cash and bank before period',snapshot->>'cash_opening_kobo'))||rows;
 elsif p_kind='receivables' then
  select count(*) into row_count from pos_sales s where s.company_id=p_company and s.total_kobo>s.returned_kobo+s.paid_kobo and(p_warehouse is null or s.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,s.warehouse_id);
  if row_count>10000 then raise exception 'Export exceeds 10000 customer balances; choose a location';end if;
  select coalesce(jsonb_agg(jsonb_build_array(s.id,s.reference,s.buyer->>'name',s.warehouse_id,s.due_date,(s.total_kobo-s.returned_kobo-s.paid_kobo)::text) order by s.due_date,s.id),'[]') into rows from pos_sales s where s.company_id=p_company and s.total_kobo>s.returned_kobo+s.paid_kobo and(p_warehouse is null or s.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,s.warehouse_id);
  rows=jsonb_build_array(jsonb_build_array('Sale ID','Reference','Customer','Warehouse','Due date','Current balance kobo'))||rows;
 else
  select count(*) into row_count from tenant_supplier_bills b where b.company_id=p_company and(p_warehouse is null or b.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,b.warehouse_id);
  if row_count>10000 then raise exception 'Export exceeds 10000 supplier bills; choose a location';end if;
  select coalesce(jsonb_agg(jsonb_build_array(b.id,s.name,b.reference,b.warehouse_id,b.due_date,b.amount_kobo::text,b.paid_kobo::text,(b.amount_kobo-b.paid_kobo)::text) order by b.due_date,b.id),'[]') into rows from tenant_supplier_bills b join suppliers s on s.company_id=b.company_id and s.id=b.supplier_id where b.company_id=p_company and(p_warehouse is null or b.warehouse_id=p_warehouse) and tenant_permission(p_company,'finance.read',null,b.warehouse_id);
  rows=jsonb_build_array(jsonb_build_array('Bill ID','Supplier','Reference','Warehouse','Due date','Amount kobo','Paid kobo','Current balance kobo'))||rows;
 end if;return rows;
end $$;
alter function tenant_finance_export(uuid,text,text,date,date,text,boolean) owner to edge_tenant_executor;
revoke all on function tenant_finance_export(uuid,text,text,date,date,text,boolean) from public,anon,authenticated;
grant execute on function tenant_finance_export(uuid,text,text,date,date,text,boolean) to authenticated;
