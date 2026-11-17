-- Additive commercial control plane. No existing commerce records are reassigned.
create table public.saas_plans(
 id text primary key check(id ~ '^[a-z][a-z0-9_-]{1,39}$'), name text not null check(length(name) between 2 and 80),
 description text not null default '' check(length(description)<=1000), available boolean not null default false,
 trial_days integer not null default 14 check(trial_days between 0 and 90), grace_days integer not null default 7 check(grace_days between 0 and 30),
 employee_limit integer not null check(employee_limit between 1 and 100000), storage_bytes bigint not null check(storage_bytes between 0 and 10995116277760),
 updated_at timestamptz not null default now()
);
create table public.saas_prices(
 id uuid primary key default gen_random_uuid(), plan_id text not null references saas_plans(id),
 months integer not null check(months in (1,3,6,12)), amount_kobo bigint not null check(amount_kobo between 100 and 100000000000),
 currency text not null default 'NGN' check(currency='NGN'), available boolean not null default false, created_at timestamptz not null default now()
);
create table public.saas_module_registry(
 id text primary key, name text not null, description text not null, ready boolean not null default false
);
insert into saas_module_registry values
 ('branding','Company branding','Validated design tokens and version history',true),
 ('field_operations','Field operations','Outlets, assignments and verified visits',true),
 ('commerce','Commerce','Requires full legacy commerce tenant cutover',false),
 ('delivery','Delivery','Requires company-scoped order and dispatch cutover',false);
create table public.saas_plan_modules(plan_id text references saas_plans(id),module text references saas_module_registry(id),primary key(plan_id,module));
insert into saas_plans(id,name,description,employee_limit,storage_bytes) values
 ('starter','Starter','Essential company operations',5,104857600),
 ('professional','Professional','Tools for a growing team',25,1073741824),
 ('business','Business','Operations across a larger organization',100,5368709120),
 ('enterprise','Enterprise','Commercial terms configured by the platform owner',1000,10737418240);
insert into saas_plan_modules select p.id,m.id from saas_plans p cross join saas_module_registry m where m.ready;
-- Plans are intentionally unpublished and prices unseeded: the owner sets commercial terms.
alter table platform_companies add column registration jsonb not null default '{}' check(jsonb_typeof(registration)='object' and octet_length(registration::text)<=8000);
create table public.saas_subscriptions(
 company_id uuid primary key references platform_companies(id), plan_id text references saas_plans(id),
 state text not null check(state in ('grandfathered','pending','trialing','active','cancelled')),
 period_end timestamptz, grace_days integer not null default 0 check(grace_days between 0 and 30),
 cancel_at_period_end boolean not null default false, updated_at timestamptz not null default now(),
 check(state='grandfathered' or plan_id is not null), check(state not in ('active','trialing') or period_end is not null)
);
insert into saas_subscriptions(company_id,state) select id,'grandfathered' from platform_companies;
create table public.saas_onboarding_requests(
 user_id uuid not null references profiles(id), key uuid not null, fingerprint text not null,
 company_id uuid not null references platform_companies(id), created_at timestamptz not null default now(),primary key(user_id,key)
);
create index saas_onboard_actor on saas_onboarding_requests(user_id,created_at desc);
create table public.saas_invoices(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references platform_companies(id),
 reference text not null unique default 'edge-saas-'||gen_random_uuid()::text,
 price_id uuid not null references saas_prices(id), plan_id text not null references saas_plans(id),
 months integer not null check(months in (1,3,6,12)), amount_kobo bigint not null check(amount_kobo>0),currency text not null check(currency='NGN'),
 grace_days integer not null check(grace_days between 0 and 30), baseline_end timestamptz,
 status text not null default 'pending' check(status in ('pending','paid','void')),
 initialization text not null default 'new' check(initialization in ('new','initializing','ready')),
 authorization_url text, provider_id text unique, paid_at timestamptz, period_start timestamptz, period_end timestamptz,
 created_by uuid not null references profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id)
);
create unique index saas_one_pending_invoice on saas_invoices(company_id) where status='pending';
create index saas_invoice_history on saas_invoices(company_id,created_at desc,id);
create index saas_subscription_expiry on saas_subscriptions(state,period_end);
create index platform_memberships_user on platform_memberships(user_id,company_id) where active;
create index platform_company_created on platform_companies(created_at desc,id);
create index platform_audit_company_created on platform_audit(company_id,created_at desc);

-- Billing recovery deliberately uses membership independent of subscription expiry/suspension.
create function public.saas_member_role(p_company uuid) returns text language sql stable security definer set search_path=public as $$
 select role from platform_memberships where company_id=p_company and user_id=auth.uid() and active
$$;
create function public.saas_access(p_company uuid) returns text language sql stable security definer set search_path=public as $$
 select case when not c.active then 'suspended' when s.company_id is null or s.state='grandfathered' then 'grandfathered'
 when s.state in ('trialing','active') and s.period_end>now() then s.state
 when s.state='active' and not s.cancel_at_period_end and s.period_end+make_interval(days=>s.grace_days)>now() then 'grace'
 else 'read_only' end from platform_companies c left join saas_subscriptions s on s.company_id=c.id where c.id=p_company
$$;
create function public.saas_can_write(p_company uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(saas_access(p_company) in ('grandfathered','trialing','active','grace'),false)
$$;
-- No service-role key is needed for onboarding; identity comes solely from Auth.
create function public.saas_onboard(p_key uuid,p_input jsonb,p_brand jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();cid uuid;prior saas_onboarding_requests;plan saas_plans;fp text:=md5(p_input::text||p_brand::text);u auth.users;
begin
 select * into u from auth.users where id=uid;
 if uid is null or u.email_confirmed_at is null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')='true' then raise exception 'A verified email account is required';end if;
 if p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8000
 or coalesce(length(trim(p_input->>'name')),0) not between 2 and 100
 or coalesce(p_input->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_input->>'slug') not between 2 and 60
 or coalesce(p_input->>'slug','') in ('admin','api','auth','platform','www','app','mail','support','billing')
 or not coalesce(valid_theme(p_brand),false) then raise exception 'Invalid company registration';end if;
 perform pg_advisory_xact_lock(hashtextextended('onboard:'||uid::text,0));
 select * into prior from saas_onboarding_requests where user_id=uid and key=p_key;
 if found then if prior.fingerprint<>fp then raise exception 'Registration key already used';end if;return prior.company_id;end if;
 select * into prior from saas_onboarding_requests where user_id=uid and fingerprint=fp order by created_at limit 1;
 if found then insert into saas_onboarding_requests(user_id,key,fingerprint,company_id) values(uid,p_key,fp,prior.company_id);return prior.company_id;end if;
 if (select count(distinct company_id) from saas_onboarding_requests where user_id=uid and created_at>now()-interval '30 days')>=3 then raise exception 'Company registration limit reached';end if;
 select * into plan from saas_plans where id=p_input->>'plan_id' and available;
 if not found then raise exception 'Plan is not available';end if;
 insert into platform_companies(slug,name,package,brand,brand_draft,registration,address)
 values(p_input->>'slug',trim(p_input->>'name'),'field_operations',p_brand,p_brand,p_input-'plan_id'-'slug'-'name',coalesce(p_input->>'address','')) returning id into cid;
 insert into platform_memberships(company_id,user_id,role,label) values(cid,uid,'company_admin',lower(u.email));
 insert into platform_modules(company_id,module,enabled) select cid,m.id,exists(select 1 from saas_plan_modules pm where pm.plan_id=plan.id and pm.module=m.id) and m.ready from saas_module_registry m;
 insert into saas_subscriptions(company_id,plan_id,state,period_end,grace_days)
 values(cid,plan.id,case when plan.trial_days>0 then 'trialing' else 'pending' end,case when plan.trial_days>0 then now()+make_interval(days=>plan.trial_days) end,plan.grace_days);
 insert into saas_onboarding_requests(user_id,key,fingerprint,company_id) values(uid,p_key,fp,cid);
 perform platform_log(cid,'saas.onboarded',jsonb_build_object('plan',plan.id));return cid;
end $$;

create function public.saas_create_invoice(p_company uuid,p_price uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare price saas_prices;plan saas_plans;s saas_subscriptions;i saas_invoices;begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_company::text,0));
 select * into s from saas_subscriptions where company_id=p_company for update;
 if not found or s.state='grandfathered' then raise exception 'Commercial migration requires platform review';end if;
 select * into price from saas_prices where id=p_price and available;
 if not found then raise exception 'Price is not available';end if;
 select * into plan from saas_plans where id=price.plan_id and available;
 if not found then raise exception 'Plan is not available';end if;
 -- Plan changes apply at renewal; do not invent an unpriced proration policy.
 if s.period_end>now() and s.state in ('active','trialing') and s.plan_id<>price.plan_id then raise exception 'Plan changes are available at the end of the current period';end if;
 if (select count(*) from (
  select lower(u.email) email from platform_memberships m join auth.users u on u.id=m.user_id where m.company_id=p_company and m.active and m.role not in ('customer','vendor')
  union select email from company_staff_invitations where company_id=p_company and active and role in ('company_admin','supervisor','van_sales')
 ) seats)>plan.employee_limit then raise exception 'Reduce employee usage before choosing this plan';end if;
 if (select coalesce(sum(size_bytes),0) from saas_assets where company_id=p_company and state<>'deleted')>plan.storage_bytes then raise exception 'Reduce storage usage before choosing this plan';end if;
 select * into i from saas_invoices where company_id=p_company and status='pending';
 if found then if i.price_id<>p_price then raise exception 'Resolve the existing invoice before changing price';end if;return to_jsonb(i);end if;
 insert into saas_invoices(company_id,price_id,plan_id,months,amount_kobo,currency,grace_days,baseline_end,created_by)
 values(p_company,price.id,plan.id,price.months,price.amount_kobo,price.currency,plan.grace_days,s.period_end,auth.uid()) returning * into i;
 perform platform_log(p_company,'saas.invoice.created',jsonb_build_object('invoice',i.id));return to_jsonb(i);
end $$;
create function public.saas_claim_initialization(p_reference text) returns jsonb language plpgsql security definer set search_path=public as $$ declare i saas_invoices;begin
 select * into i from saas_invoices where reference=p_reference for update;
 if not found or i.status<>'pending' then raise exception 'Invoice unavailable';end if;
 if i.initialization='ready' then return jsonb_build_object('url',i.authorization_url);end if;
 if i.initialization='initializing' then raise exception 'Payment initialization requires reconciliation';end if;
 update saas_invoices set initialization='initializing' where id=i.id;return jsonb_build_object('claimed',true);
end $$;
create function public.saas_save_initialization(p_reference text,p_url text) returns void language plpgsql security definer set search_path=public as $$ begin
 if p_url is null or p_url !~ '^https://checkout[.]paystack[.]com/[A-Za-z0-9_-]+$' then raise exception 'Invalid provider URL';end if;
 update saas_invoices set initialization='ready',authorization_url=p_url where reference=p_reference and status='pending' and initialization='initializing';
 if not found then raise exception 'Invoice unavailable';end if;
end $$;
create function public.saas_apply_payment(p_reference text,p_amount bigint,p_currency text,p_status text,p_provider_id text) returns jsonb language plpgsql security definer set search_path=public as $$
declare i saas_invoices;s saas_subscriptions;starts timestamptz;ends timestamptz;begin
 select * into i from saas_invoices where reference=p_reference;
 if not found then raise exception 'Unknown subscription payment';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||i.company_id::text,0));
 select * into i from saas_invoices where reference=p_reference for update;
 if p_amount is distinct from i.amount_kobo or p_currency is distinct from i.currency or p_status is distinct from 'success' or coalesce(p_provider_id,'') !~ '^[0-9]{1,30}$' then raise exception 'Payment verification mismatch';end if;
 if i.status='paid' then if i.provider_id<>p_provider_id then raise exception 'Provider transaction mismatch';end if;return to_jsonb(i);end if;
 if i.status<>'pending' then raise exception 'Payment requires reconciliation';end if;
 select * into s from saas_subscriptions where company_id=i.company_id for update;
 if s.period_end is distinct from i.baseline_end then raise exception 'Subscription changed; payment requires reconciliation';end if;
 starts=greatest(now(),coalesce(s.period_end,now()));ends=starts+make_interval(months=>i.months);
 update saas_subscriptions set plan_id=i.plan_id,state='active',period_end=ends,grace_days=i.grace_days,cancel_at_period_end=false,updated_at=now() where company_id=i.company_id;
 update saas_invoices set status='paid',provider_id=p_provider_id,paid_at=now(),period_start=starts,period_end=ends where id=i.id returning * into i;
 update platform_modules m set enabled=r.ready and exists(select 1 from saas_plan_modules pm where pm.plan_id=i.plan_id and pm.module=m.module) from saas_module_registry r where m.company_id=i.company_id and r.id=m.module;
 perform platform_log(i.company_id,'saas.payment.verified',jsonb_build_object('invoice',i.id,'reference',i.reference));return to_jsonb(i);
end $$;
create function public.saas_cancel(p_company uuid,p_cancel boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_company::text,0));
 update saas_subscriptions set cancel_at_period_end=p_cancel,updated_at=now() where company_id=p_company and state in ('trialing','active');
 if not found then raise exception 'Subscription unavailable';end if;
 perform platform_log(p_company,'saas.cancellation',jsonb_build_object('cancel_at_period_end',p_cancel));
end $$;

create function public.saas_configure_plan(p_plan jsonb,p_modules text[]) returns void language plpgsql security definer set search_path=public as $$ begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 if p_modules is null or exists(select 1 from unnest(p_modules) m where not exists(select 1 from saas_module_registry where id=m and ready)) then raise exception 'Module is not provisioned for tenants';end if;
 insert into saas_plans(id,name,description,available,trial_days,grace_days,employee_limit,storage_bytes)
 values(p_plan->>'id',p_plan->>'name',coalesce(p_plan->>'description',''),(p_plan->>'available')::boolean,(p_plan->>'trial_days')::integer,(p_plan->>'grace_days')::integer,(p_plan->>'employee_limit')::integer,(p_plan->>'storage_bytes')::bigint)
 on conflict(id) do update set name=excluded.name,description=excluded.description,available=excluded.available,trial_days=excluded.trial_days,grace_days=excluded.grace_days,employee_limit=excluded.employee_limit,storage_bytes=excluded.storage_bytes,updated_at=now();
 delete from saas_plan_modules where plan_id=p_plan->>'id';insert into saas_plan_modules select p_plan->>'id',m from unnest(p_modules) m;
 perform platform_log(null,'saas.plan.configured',jsonb_build_object('plan',p_plan->>'id'));
end $$;
create function public.saas_publish_price(p_plan text,p_months integer,p_amount bigint) returns uuid language plpgsql security definer set search_path=public as $$ declare pid uuid;begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('price:'||p_plan||':'||p_months::text,0));
 update saas_prices set available=false where plan_id=p_plan and months=p_months;
 insert into saas_prices(plan_id,months,amount_kobo,available) values(p_plan,p_months,p_amount,true) returning id into pid;
 perform platform_log(null,'saas.price.published',jsonb_build_object('price',pid));return pid;
end $$;

-- New commercial companies become read-only after expiry. Existing access is grandfathered.
create function public.saas_guard_company_write() returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;lim integer;member_email text;begin
 cid=case when tg_op='DELETE' then old.company_id else new.company_id end;
 if not saas_can_write(cid) and not platform_is_admin() then raise exception 'Subscription is read-only; renew from company settings';end if;
 if tg_table_name='platform_memberships' and tg_op<>'DELETE' then
  if new.active and new.role not in ('customer','vendor') then
   perform pg_advisory_xact_lock(hashtextextended('employees:'||cid::text,0));
   select p.employee_limit into lim from saas_subscriptions s join saas_plans p on p.id=s.plan_id where s.company_id=cid and s.state<>'grandfathered';
   select lower(email) into member_email from auth.users where id=new.user_id;
   if lim is not null and not exists(select 1 from platform_memberships where company_id=cid and user_id=new.user_id and active and role not in ('customer','vendor'))
   and not exists(select 1 from company_staff_invitations where company_id=cid and email=member_email and active and role in ('company_admin','supervisor','van_sales')) and (select count(*) from (
    select lower(u.email) email from platform_memberships m join auth.users u on u.id=m.user_id where m.company_id=cid and m.active and m.role not in ('customer','vendor')
    union select email from company_staff_invitations where company_id=cid and active and role in ('company_admin','supervisor','van_sales')
   ) seats where email is distinct from member_email)>=lim then raise exception 'Employee limit reached';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$ declare t text;begin foreach t in array array['platform_memberships','field_stores','field_assignments','field_shifts','field_visits','field_route_access','field_location_requests','team_schedules','team_emergency_contacts','team_messages'] loop
 execute format('create trigger saas_write_guard before insert or update or delete on public.%I for each row execute function public.saas_guard_company_write()',t);
end loop;end $$;

do $$ declare t text;begin foreach t in array array['saas_plans','saas_prices','saas_module_registry','saas_plan_modules','saas_subscriptions','saas_onboarding_requests','saas_invoices'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;end $$;
grant select on saas_plans,saas_prices,saas_module_registry,saas_plan_modules to anon,authenticated;
create policy saas_plan_read on saas_plans for select using(available or platform_is_admin());
create policy saas_price_read on saas_prices for select using((available and exists(select 1 from saas_plans where id=plan_id and available)) or platform_is_admin());
create policy saas_module_read on saas_module_registry for select using(true);
create policy saas_plan_module_read on saas_plan_modules for select using(exists(select 1 from saas_plans where id=plan_id and available) or platform_is_admin());
grant select on saas_subscriptions,saas_invoices to authenticated;
create policy saas_subscription_read on saas_subscriptions for select using(saas_member_role(company_id)='company_admin' or platform_is_admin());
create policy saas_invoice_read on saas_invoices for select using(saas_member_role(company_id)='company_admin' or platform_is_admin());
-- Revoke implicit PUBLIC execution, including trigger/internal helper entrypoints.
revoke all on function saas_member_role(uuid),saas_access(uuid),saas_can_write(uuid),saas_guard_company_write(),saas_onboard(uuid,jsonb,jsonb),saas_create_invoice(uuid,uuid),saas_cancel(uuid,boolean),saas_configure_plan(jsonb,text[]),saas_publish_price(text,integer,bigint),saas_claim_initialization(text),saas_save_initialization(text,text),saas_apply_payment(text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function saas_member_role(uuid),saas_access(uuid),saas_can_write(uuid),saas_onboard(uuid,jsonb,jsonb),saas_create_invoice(uuid,uuid),saas_cancel(uuid,boolean),saas_configure_plan(jsonb,text[]),saas_publish_price(text,integer,bigint) to authenticated;
-- Public plan policies call this already existing, MFA-gated predicate.
grant execute on function platform_is_admin() to anon;
grant execute on function saas_claim_initialization(text),saas_save_initialization(text,text),saas_apply_payment(text,bigint,text,text,text) to service_role;
