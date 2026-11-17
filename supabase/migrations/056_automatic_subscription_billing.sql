create table public.saas_autopay_intents(reference text primary key references saas_invoices(reference),company_id uuid not null references platform_companies(id),actor uuid not null references profiles(id),enabled boolean not null,consent_version text not null check(consent_version='2026-11-16'),processed_at timestamptz,outcome text,created_at timestamptz not null default now());
create table public.saas_autopay(company_id uuid primary key references platform_companies(id),price_id uuid not null references saas_prices(id),authorization_ciphertext text not null check(length(authorization_ciphertext) between 40 and 4096),customer_email text not null,consented_by uuid not null references profiles(id),consent_version text not null,consented_at timestamptz not null,enabled boolean not null default true,failures integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,updated_at timestamptz not null default now());
create table public.saas_charge_jobs(id uuid primary key default gen_random_uuid(),company_id uuid not null references platform_companies(id),reference text not null unique references saas_invoices(reference),state text not null default 'queued' check(state in ('queued','charging','verifying','done','failed','review')),lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz not null default now(),attempts integer not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index saas_charge_due on saas_charge_jobs(next_attempt_at,created_at) where state in ('queued','charging','verifying');
create table public.saas_notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null references platform_companies(id),event_key text not null unique,title text not null,body text not null,created_at timestamptz not null default now());
create table public.saas_worker_heartbeats(name text primary key,last_success_at timestamptz not null,detail jsonb not null default '{}');
do $$ declare t text;begin foreach t in array array['saas_autopay_intents','saas_autopay','saas_charge_jobs','saas_notifications','saas_worker_heartbeats'] loop execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);end loop;end $$;
grant select on saas_notifications to authenticated;
create policy billing_notification_read on saas_notifications for select using(saas_member_role(company_id)='company_admin');

create function public.saas_autopay_intent(p_reference text,p_enable boolean,p_version text) returns void language plpgsql security definer set search_path=public as $$ declare i saas_invoices;begin
 select * into i from saas_invoices where reference=p_reference;
 if not found or i.created_by<>auth.uid() or saas_member_role(i.company_id) is distinct from 'company_admin' or i.status<>'pending' or p_enable is null or p_version is distinct from '2026-11-16' then raise exception 'Forbidden';end if;
 insert into saas_autopay_intents(reference,company_id,actor,enabled,consent_version) values(p_reference,i.company_id,auth.uid(),p_enable,p_version) on conflict(reference) do update set enabled=excluded.enabled,consent_version=excluded.consent_version,created_at=now() where saas_autopay_intents.actor=auth.uid();
 perform platform_log(i.company_id,'saas.autopay.consent',jsonb_build_object('reference',p_reference,'enabled',p_enable,'version',p_version));
end $$;
create function public.saas_autopay_setup_context(p_reference text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('company_id',i.company_id,'price_id',i.price_id,'email',lower(u.email)) from saas_invoices i join saas_autopay_intents a on a.reference=i.reference join auth.users u on u.id=a.actor where i.reference=p_reference and i.status='paid' and a.enabled and a.processed_at is null
$$;
create function public.saas_save_autopay(p_reference text,p_ciphertext text,p_email text) returns void language plpgsql security definer set search_path=public as $$ declare i saas_invoices;a saas_autopay_intents;begin
 select * into i from saas_invoices where reference=p_reference and status='paid';if not found then raise exception 'Verified payment required';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||i.company_id::text,0));
 select * into a from saas_autopay_intents where reference=p_reference for update;if not found then raise exception 'Explicit automatic billing consent required';end if;
 if a.processed_at is not null or not a.enabled then return;end if;
 if not exists(select 1 from auth.users where id=a.actor and lower(email)=lower(p_email) and email_confirmed_at is not null) then raise exception 'Payer identity mismatch';end if;
 insert into saas_autopay(company_id,price_id,authorization_ciphertext,customer_email,consented_by,consent_version,consented_at) values(i.company_id,i.price_id,p_ciphertext,lower(p_email),a.actor,a.consent_version,a.created_at)
 on conflict(company_id) do update set price_id=excluded.price_id,authorization_ciphertext=excluded.authorization_ciphertext,customer_email=excluded.customer_email,consented_by=excluded.consented_by,consent_version=excluded.consent_version,consented_at=excluded.consented_at,enabled=true,failures=0,next_attempt_at=now(),last_error=null,updated_at=now() where saas_autopay.consented_at<=excluded.consented_at;
 update saas_autopay_intents set processed_at=now(),outcome='enabled' where reference=p_reference;
 perform platform_log(i.company_id,'saas.autopay.enabled',jsonb_build_object('reference',p_reference));
end $$;
create function public.saas_disable_autopay(p_company uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_company::text,0));
 update saas_autopay set enabled=false,updated_at=now() where company_id=p_company;
 update saas_autopay_intents set enabled=false,processed_at=now(),outcome='cancelled' where company_id=p_company and processed_at is null;
 update saas_invoices i set status='void' where i.company_id=p_company and i.status='pending' and i.initialization='new' and exists(select 1 from saas_charge_jobs j where j.reference=i.reference and j.state='queued');
 -- Submitted/uncertain charges must still be reconciled; never retry them under a new reference.
 update saas_charge_jobs set state='review',last_error='automatic-billing-disabled',updated_at=now() where company_id=p_company and state='queued';
 perform platform_log(p_company,'saas.autopay.disabled');
end $$;
create function public.saas_autopay_status(p_company uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 return jsonb_build_object('automatic',(select jsonb_build_object('enabled',enabled,'price_id',price_id,'consented_at',consented_at,'failures',failures,'last_error',last_error) from saas_autopay where company_id=p_company),'notifications',coalesce((select jsonb_agg(to_jsonb(n)) from(select title,body,created_at from saas_notifications where company_id=p_company order by created_at desc limit 20)n),'[]'));
end $$;
create function public.saas_enqueue_renewals() returns integer language plpgsql security definer set search_path=public as $$ declare a saas_autopay;s saas_subscriptions;p saas_prices;i saas_invoices;n integer:=0;begin
 for a in select x.* from saas_autopay x join saas_subscriptions b on b.company_id=x.company_id join platform_companies c on c.id=x.company_id where x.enabled and x.next_attempt_at<=now() and x.failures<3 and b.state='active' and b.period_end<=now() and not b.cancel_at_period_end and c.active order by b.period_end limit 100 loop
  perform pg_advisory_xact_lock(hashtextextended('billing:'||a.company_id::text,0));
  select * into s from saas_subscriptions where company_id=a.company_id for update;
  if s.period_end>now() or s.cancel_at_period_end or exists(select 1 from saas_invoices where company_id=a.company_id and status='pending') then continue;end if;
  select * into p from saas_prices where id=a.price_id;
  if p.plan_id is distinct from s.plan_id then update saas_autopay set enabled=false,last_error='plan-change-requires-consent' where company_id=a.company_id;continue;end if;
  insert into saas_invoices(company_id,price_id,plan_id,months,amount_kobo,currency,grace_days,baseline_end,created_by) values(a.company_id,p.id,p.plan_id,p.months,p.amount_kobo,p.currency,s.grace_days,s.period_end,a.consented_by) returning * into i;
  insert into saas_charge_jobs(company_id,reference) values(a.company_id,i.reference);n=n+1;
 end loop;return n;
end $$;
create function public.saas_claim_charge_jobs(p_limit integer default 5) returns jsonb language plpgsql security definer set search_path=public as $$ declare j saas_charge_jobs;i saas_invoices;a saas_autopay;token uuid;submit boolean;result jsonb:='[]';begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid job batch';end if;
 for j in select * from saas_charge_jobs where state in ('queued','charging','verifying') and next_attempt_at<=now() and(lease_until is null or lease_until<now()) order by next_attempt_at,created_at limit p_limit for update skip locked loop
  select * into a from saas_autopay where company_id=j.company_id;
  select * into i from saas_invoices where reference=j.reference for update;
  if i.status='paid' then update saas_charge_jobs set state='done',updated_at=now() where id=j.id;continue;end if;
  if i.status<>'pending' then update saas_charge_jobs set state='review',last_error='invoice-state-changed' where id=j.id;continue;end if;
  submit=i.initialization='new';
  if submit and(not a.enabled or exists(select 1 from saas_subscriptions where company_id=j.company_id and cancel_at_period_end)) then update saas_charge_jobs set state='review',last_error='consent-cancelled' where id=j.id;continue;end if;
  token=gen_random_uuid();update saas_charge_jobs set state=case when submit then 'charging' else 'verifying' end,lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=j.id;
  if submit then update saas_invoices set initialization='initializing' where id=i.id;end if;
  result=result||jsonb_build_array(jsonb_build_object('id',j.id,'lease',token,'company_id',j.company_id,'reference',j.reference,'amount',i.amount_kobo,'currency',i.currency,'submit',submit,'email',a.customer_email,'ciphertext',a.authorization_ciphertext,'created_at',j.created_at));
 end loop;return result;
end $$;
create function public.saas_finish_charge_job(p_id uuid,p_lease uuid,p_outcome text,p_error text default '') returns void language plpgsql security definer set search_path=public as $$ declare j saas_charge_jobs;failures integer;begin
 select * into j from saas_charge_jobs where id=p_id and lease_token=p_lease and state in ('charging','verifying') for update;
 if not found then raise exception 'Worker lease unavailable';end if;
 if p_outcome='paid' then
  if not exists(select 1 from saas_invoices where reference=j.reference and status='paid') then raise exception 'Verified payment required';end if;
  update saas_charge_jobs set state='done',lease_until=null,updated_at=now() where id=p_id;
  update saas_autopay set failures=0,last_error=null,updated_at=now() where company_id=j.company_id;
 elsif p_outcome in ('failed','abandoned') then
  perform saas_void_failed_invoice(j.reference,p_outcome);
  update saas_charge_jobs set state='failed',lease_until=null,last_error=p_outcome,updated_at=now() where id=p_id;
  update saas_autopay set failures=saas_autopay.failures+1,last_error=p_outcome,next_attempt_at=now()+case when saas_autopay.failures=0 then interval '1 hour' else interval '24 hours' end,updated_at=now() where company_id=j.company_id returning saas_autopay.failures into failures;
  insert into saas_notifications(company_id,event_key,title,body) values(j.company_id,'charge-failed:'||j.reference,'Subscription renewal failed','The payment provider declined the renewal. Review billing and update payment authorization. No access was activated from this failed attempt.') on conflict(event_key) do nothing;
 elsif p_outcome in ('pending','review') then
  update saas_charge_jobs set state=case when p_outcome='review' then 'review' else 'verifying' end,lease_until=null,next_attempt_at=now()+interval '5 minutes',last_error=left(p_error,100),updated_at=now() where id=p_id;
 else raise exception 'Invalid job outcome';end if;
end $$;
create function public.saas_worker_heartbeat(p_detail jsonb) returns void language sql security definer set search_path=public as $$ insert into saas_worker_heartbeats(name,last_success_at,detail) values('billing',now(),p_detail) on conflict(name) do update set last_success_at=now(),detail=excluded.detail $$;
revoke all on function saas_autopay_intent(text,boolean,text),saas_autopay_setup_context(text),saas_save_autopay(text,text,text),saas_disable_autopay(uuid),saas_autopay_status(uuid),saas_enqueue_renewals(),saas_claim_charge_jobs(integer),saas_finish_charge_job(uuid,uuid,text,text),saas_worker_heartbeat(jsonb) from public,anon,authenticated;
grant execute on function saas_autopay_intent(text,boolean,text),saas_disable_autopay(uuid),saas_autopay_status(uuid) to authenticated;
grant execute on function saas_autopay_setup_context(text),saas_save_autopay(text,text,text),saas_enqueue_renewals(),saas_claim_charge_jobs(integer),saas_finish_charge_job(uuid,uuid,text,text),saas_worker_heartbeat(jsonb) to service_role;
create function public.saas_autopay_unavailable(p_reference text) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 update saas_autopay_intents set processed_at=now(),outcome='provider-authorization-not-reusable' where reference=p_reference and processed_at is null and enabled returning company_id into cid;
 if found then insert into saas_notifications(company_id,event_key,title,body) values(cid,'autopay-unavailable:'||p_reference,'Automatic renewal was not enabled','Your payment was verified, but this payment method did not provide a reusable authorization. Renew manually or use an eligible payment method.') on conflict(event_key) do nothing;end if;
end $$;
revoke all on function saas_autopay_unavailable(text) from public,anon,authenticated;grant execute on function saas_autopay_unavailable(text) to service_role;
create or replace function public.saas_cancel(p_company uuid,p_cancel boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_company::text,0));
 update saas_subscriptions set cancel_at_period_end=p_cancel,updated_at=now() where company_id=p_company and state in ('trialing','active');if not found then raise exception 'Subscription unavailable';end if;
 if p_cancel then perform saas_disable_autopay(p_company);end if;
 perform platform_log(p_company,'saas.cancellation',jsonb_build_object('cancel_at_period_end',p_cancel));
end $$;
