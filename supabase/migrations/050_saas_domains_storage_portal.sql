-- Domain ownership is separate from hosting/TLS readiness. Existing rows stay inactive.
alter table platform_domains add column challenge uuid not null default gen_random_uuid();
alter table platform_domains add column challenge_expires_at timestamptz not null default now()+interval '7 days';
alter table platform_domains add column verified_until timestamptz;
alter table platform_domains add column state text not null default 'pending' check(state in ('pending','verified','active','suspended'));
alter table platform_domains add column tls_ready boolean not null default false;
alter table platform_domains add column is_primary boolean not null default false;
create unique index saas_primary_domain on platform_domains(company_id) where is_primary;
create index saas_company_domains on platform_domains(company_id,host);
create table public.saas_assets(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references platform_companies(id),
 path text not null unique,mime text not null check(mime in ('image/png','image/jpeg','image/webp','application/pdf')),
 size_bytes bigint not null check(size_bytes between 1 and 5242880),
 state text not null default 'reserved' check(state in ('reserved','ready','deleted')),
 created_by uuid not null references profiles(id),created_at timestamptz not null default now(),
 check(path ~ '^tenants/[0-9a-f-]{36}/(logos|products|invoices|documents|avatars)/[0-9a-f-]{36}[.](png|jpeg|webp|pdf)$'),
 check(split_part(path,'/',2)=company_id::text)
);
create index saas_asset_usage on saas_assets(company_id,state,created_at desc);
alter table saas_assets enable row level security;
revoke all on saas_assets from public,anon,authenticated;
grant select on saas_assets to authenticated;
create policy saas_asset_read on saas_assets for select using(saas_member_role(company_id)='company_admin');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tenant-files','tenant-files',false,5242880,array['image/png','image/jpeg','image/webp','application/pdf']) on conflict(id) do nothing;
-- All uploads go through the bounded server API after a locked quota reservation.
-- Do not grant direct INSERT: Storage metadata supplied by a client is not quota evidence.
create policy saas_file_read on storage.objects for select to authenticated using(bucket_id='tenant-files' and exists(
 select 1 from saas_assets a where a.path=storage.objects.name and a.state='ready' and saas_member_role(a.company_id)='company_admin'
));

create function public.saas_request_domain(p_company uuid,p_host text) returns jsonb language plpgsql security definer set search_path=public as $$ declare d platform_domains;begin
 if saas_member_role(p_company) is distinct from 'company_admin' or not saas_can_write(p_company) then raise exception 'Forbidden';end if;
 perform saas_rate_limit('settings');
 if p_host is null or length(p_host)>253 or p_host<>lower(trim(p_host)) or p_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$' then raise exception 'Invalid hostname';end if;
 perform pg_advisory_xact_lock(hashtextextended('domains:'||p_company::text,0));
 select * into d from platform_domains where host=p_host;
 if found then if d.company_id<>p_company then raise exception 'Domain unavailable';end if;return to_jsonb(d);end if;
 if (select count(*) from platform_domains where company_id=p_company)>=10 then raise exception 'Domain limit reached';end if;
 insert into platform_domains(host,company_id) values(p_host,p_company) returning * into d;
 perform platform_log(p_company,'saas.domain.requested',jsonb_build_object('host',p_host));return to_jsonb(d);
end $$;
create function public.saas_verify_domain(p_host text,p_challenge uuid) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 update platform_domains set verified=true,verified_until=now()+interval '30 days',state=case when state='active' then 'active' else 'verified' end
 where host=p_host and challenge=p_challenge and challenge_expires_at>now() returning company_id into cid;
 if not found then raise exception 'Domain challenge expired or changed';end if;
 perform platform_log(cid,'saas.domain.verified',jsonb_build_object('host',p_host));
end $$;
create function public.saas_domain_action(p_company uuid,p_host text,p_action text) returns void language plpgsql security definer set search_path=public as $$ declare d platform_domains;begin
 if saas_member_role(p_company) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('domains:'||p_company::text,0));
 select * into d from platform_domains where company_id=p_company and host=p_host for update;
 if not found then raise exception 'Domain unavailable';end if;
 if p_action='remove' then delete from platform_domains where host=p_host;
 elsif p_action='challenge' then update platform_domains set challenge=gen_random_uuid(),challenge_expires_at=now()+interval '7 days' where host=p_host;
 elsif p_action='primary' then
  if d.state<>'active' or not d.tls_ready or not d.verified or d.verified_until<=now() then raise exception 'Activate and verify the domain first';end if;
  update platform_domains set is_primary=false where company_id=p_company;update platform_domains set is_primary=true where host=p_host;
 elsif p_action='suspend' then update platform_domains set state='suspended',is_primary=false where host=p_host;
 else raise exception 'Invalid domain action';end if;
 perform platform_log(p_company,'saas.domain.'||p_action,jsonb_build_object('host',p_host));
end $$;
-- Only the MFA-protected operator can record successful provider/SSL commissioning.
create function public.saas_activate_domain(p_host text,p_ready boolean) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 update platform_domains set tls_ready=p_ready,state=case when p_ready then 'active' else 'suspended' end,is_primary=case when p_ready then is_primary else false end
 where host=p_host and verified and verified_until>now() returning company_id into cid;
 if not found then raise exception 'Domain ownership verification required';end if;
 perform platform_log(cid,'saas.domain.hosting',jsonb_build_object('host',p_host,'tls_ready',p_ready));
end $$;
create function public.saas_resolve_host(p_host text) returns text language sql stable security definer set search_path=public as $$
 select c.slug from platform_domains d join platform_companies c on c.id=d.company_id
 where d.host=p_host and d.verified and d.verified_until>now() and d.state='active' and d.tls_ready and c.active
$$;

create function public.saas_reserve_asset(p_company uuid,p_folder text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare aid uuid:=gen_random_uuid();p text;lim bigint;used bigint;ext text;begin
 if saas_member_role(p_company) is distinct from 'company_admin' or not saas_can_write(p_company) then raise exception 'Forbidden';end if;
 if p_folder is null or p_folder not in ('logos','products','invoices','documents','avatars') or p_size is null or p_size not between 1 and 5242880 then raise exception 'Invalid file';end if;
 ext=case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpeg' when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
 if ext is null or (p_folder in ('logos','products','avatars') and ext='pdf') then raise exception 'Invalid file type';end if;
 if (select count(*) from saas_assets where created_by=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Hourly upload limit reached';end if;
 perform pg_advisory_xact_lock(hashtextextended('storage:'||p_company::text,0));
 select p.storage_bytes into lim from saas_subscriptions s join saas_plans p on p.id=s.plan_id where s.company_id=p_company and s.state<>'grandfathered';
 if lim is null then raise exception 'Configure a commercial storage allocation first';end if;
 select coalesce(sum(size_bytes),0) into used from saas_assets where company_id=p_company and state<>'deleted';
 if used+p_size>lim then raise exception 'Storage limit reached';end if;
 p='tenants/'||p_company::text||'/'||p_folder||'/'||aid::text||'.'||ext;
 insert into saas_assets(id,company_id,path,mime,size_bytes,created_by) values(aid,p_company,p,p_mime,p_size,auth.uid());
 return jsonb_build_object('id',aid,'path',p);
end $$;
create function public.saas_finalize_asset(p_id uuid,p_ready boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 update saas_assets set state=case when p_ready then 'ready' else 'deleted' end where id=p_id and state='reserved';
 if not found then raise exception 'File reservation unavailable';end if;
end $$;
create function public.saas_remove_asset(p_id uuid) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 select company_id into cid from saas_assets where id=p_id;
 update saas_assets set state='deleted' where id=p_id;
 perform platform_log(cid,'saas.asset.removed',jsonb_build_object('asset',p_id));
end $$;

create function public.saas_portal(p_slug text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c platform_companies;result jsonb;begin
 select * into c from platform_companies where slug=p_slug;
 if not found or saas_member_role(c.id) is distinct from 'company_admin' then raise exception 'Forbidden';end if;
 select jsonb_build_object('company',to_jsonb(c),'access',saas_access(c.id),'subscription',(select to_jsonb(s) from saas_subscriptions s where company_id=c.id),
 'plan',(select to_jsonb(p) from saas_plans p join saas_subscriptions s on s.plan_id=p.id where s.company_id=c.id),
 'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by created_at desc) from(select * from saas_invoices where company_id=c.id order by created_at desc,id limit 50)i),'[]'),
 'domains',coalesce((select jsonb_agg(to_jsonb(d) order by host) from platform_domains d where company_id=c.id),'[]'),
 'assets',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from(select * from saas_assets where company_id=c.id and state='ready' order by created_at desc,id limit 50)a),'[]'),
 'usage',jsonb_build_object('employees',(select count(*) from platform_memberships where company_id=c.id and active and role not in ('customer','vendor')),
 'storage_bytes',(select coalesce(sum(size_bytes),0) from saas_assets where company_id=c.id and state<>'deleted'))
 ) into result;return result;
end $$;
create function public.saas_platform_overview(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid page';end if;
 return jsonb_build_object('total',(select count(*) from platform_companies),'active',(select count(*) from platform_companies where active),
 'trialing',(select count(*) from saas_subscriptions where state='trialing' and period_end>now()),
 'suspended',(select count(*) from platform_companies where not active),
 'users',(select count(distinct user_id) from platform_memberships where active),
 'mrr_kobo',coalesce((select sum(i.amount_kobo/i.months) from saas_subscriptions s join lateral(select amount_kobo,months from saas_invoices where company_id=s.company_id and status='paid' order by paid_at desc,id limit 1)i on true where s.state='active' and s.period_end>now()),0),
 'companies',coalesce((select jsonb_agg(to_jsonb(c)) from(select id,slug,name,active,created_at from platform_companies order by created_at desc,id limit 25 offset(p_page-1)*25)c),'[]'),
 'plans',(select jsonb_agg(to_jsonb(p) order by id) from saas_plans p),'plan_modules',coalesce((select jsonb_agg(to_jsonb(m)) from saas_plan_modules m),'[]'),'prices',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc) from saas_prices p where available),'[]'),
 'domains',coalesce((select jsonb_agg(to_jsonb(d)) from(select * from platform_domains order by host limit 100)d),'[]'));
end $$;
revoke all on function saas_request_domain(uuid,text),saas_verify_domain(text,uuid),saas_domain_action(uuid,text,text),saas_activate_domain(text,boolean),saas_resolve_host(text),saas_reserve_asset(uuid,text,text,bigint),saas_finalize_asset(uuid,boolean),saas_remove_asset(uuid),saas_portal(text),saas_platform_overview(integer) from public,anon,authenticated;
grant execute on function saas_request_domain(uuid,text),saas_domain_action(uuid,text,text),saas_activate_domain(text,boolean),saas_reserve_asset(uuid,text,text,bigint),saas_portal(text),saas_platform_overview(integer) to authenticated;
grant execute on function saas_resolve_host(text) to anon,authenticated;
grant execute on function saas_verify_domain(text,uuid),saas_finalize_asset(uuid,boolean),saas_remove_asset(uuid) to service_role;
