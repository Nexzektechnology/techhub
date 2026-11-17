create table public.saas_rate_limits(user_id uuid not null references profiles(id),action text not null,bucket timestamptz not null,n integer not null,primary key(user_id,action,bucket));
alter table saas_rate_limits enable row level security;
revoke all on saas_rate_limits from public,anon,authenticated;
create function public.saas_rate_limit(p_action text) returns void language plpgsql security definer set search_path=public as $$ declare used integer;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_action is null or p_action not in ('billing','domain-verification','assets','settings') then raise exception 'Invalid action';end if;
 insert into saas_rate_limits values(auth.uid(),p_action,date_trunc('minute',now()),1)
 on conflict(user_id,action,bucket) do update set n=saas_rate_limits.n+1 returning n into used;
 if used>20 then raise exception 'Request limit reached; try again in a minute';end if;
 delete from saas_rate_limits where user_id=auth.uid() and bucket<now()-interval '1 day';
end $$;
create function public.saas_guard_brand_write() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if not saas_can_write(new.id) and not platform_is_admin() then raise exception 'Subscription is read-only; renew from company settings';end if;
 if (old.brand is distinct from new.brand or old.brand_draft is distinct from new.brand_draft) and not exists(select 1 from platform_modules where company_id=new.id and module='branding' and enabled) and not platform_is_admin() then raise exception 'Branding module unavailable';end if;
 return new;
end $$;
create trigger saas_brand_write_guard before update of brand,brand_draft,geofence_metres,daily_target,allow_web_checkin on platform_companies for each row execute function saas_guard_brand_write();
grant select on saas_invoices,saas_assets to service_role;
revoke all on function saas_rate_limit(text),saas_guard_brand_write() from public,anon,authenticated;
grant execute on function saas_rate_limit(text) to authenticated;
create function public.saas_public_logo(p_id uuid) returns text language sql stable security definer set search_path=public as $$
 select a.path from saas_assets a join platform_companies c on c.id=a.company_id
 where a.id=p_id and a.state='ready' and a.mime in ('image/png','image/jpeg','image/webp') and split_part(a.path,'/',3)='logos' and c.active
 and ('/api/saas/logo/'||a.id::text) in (c.brand->>'logo',c.brand->>'lightLogo',c.brand->>'darkLogo',c.brand->>'mobileLogo',c.brand->>'favicon')
$$;
create function public.saas_void_failed_invoice(p_reference text,p_status text) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 if p_status is null or p_status not in ('failed','abandoned') then raise exception 'Final failed transaction evidence required';end if;
 select company_id into cid from saas_invoices where reference=p_reference;
 if not found then raise exception 'Invoice unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||cid::text,0));
 update saas_invoices set status='void' where reference=p_reference and status='pending';
 if not found then raise exception 'Invoice is no longer pending';end if;
 perform platform_log(cid,'saas.payment.failed',jsonb_build_object('reference',p_reference,'status',p_status));
end $$;
revoke all on function saas_public_logo(uuid),saas_void_failed_invoice(text,text) from public,anon,authenticated;
grant execute on function saas_public_logo(uuid) to anon,authenticated;
grant execute on function saas_void_failed_invoice(text,text) to service_role;

create function public.saas_guard_invitation() returns trigger language plpgsql security definer set search_path=public as $$ declare lim integer;begin
 if not saas_can_write(new.company_id) and not platform_is_admin() then raise exception 'Subscription is read-only; renew from company settings';end if;
 if new.active and new.role in ('company_admin','supervisor','van_sales') then
  perform pg_advisory_xact_lock(hashtextextended('employees:'||new.company_id::text,0));
  select p.employee_limit into lim from saas_subscriptions s join saas_plans p on p.id=s.plan_id where s.company_id=new.company_id and s.state<>'grandfathered';
  if lim is not null and not exists(select 1 from platform_memberships m join auth.users u on u.id=m.user_id where m.company_id=new.company_id and m.active and m.role not in ('customer','vendor') and lower(u.email)=new.email)
  and not exists(select 1 from company_staff_invitations where company_id=new.company_id and email=new.email and active and role in ('company_admin','supervisor','van_sales')) and (select count(*) from (
   select lower(u.email) email from platform_memberships m join auth.users u on u.id=m.user_id where m.company_id=new.company_id and m.active and m.role not in ('customer','vendor')
   union select email from company_staff_invitations where company_id=new.company_id and active and role in ('company_admin','supervisor','van_sales')
  ) seats where email<>new.email)>=lim then raise exception 'Employee limit reached';end if;
 end if;return new;
end $$;
create trigger saas_invitation_guard before insert or update on company_staff_invitations for each row execute function saas_guard_invitation();
-- An expired invitation must not prevent sign-in or access to another company's billing portal.
create or replace function public.company_claim_staff() returns void language plpgsql security definer set search_path=public as $$
declare u jsonb;i company_staff_invitations;member_role text;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select to_jsonb(x) into u from auth.users x where x.id=auth.uid();
 if u->>'email_confirmed_at' is null or coalesce((u->>'is_anonymous')::boolean,false) then return;end if;
 for i in select * from company_staff_invitations where email=lower(u->>'email') and active and claimed_at is null for update loop
  if not saas_can_write(i.company_id) then continue;end if;
  member_role:=case i.role when 'van_sales' then 'field_agent' when 'delivery_driver' then 'field_agent' when 'supervisor' then 'supervisor' when 'company_admin' then 'company_admin' when 'it_manager' then 'company_admin' else 'customer' end;
  if member_role<>'customer' then
   insert into platform_memberships(company_id,user_id,role,label,active) values(i.company_id,auth.uid(),member_role,i.name,true)
   on conflict(company_id,user_id) do update set role=excluded.role,label=excluded.label,active=true;
  end if;
  if i.role='delivery_driver' then
   update profiles set role='driver' where id=auth.uid() and role in ('customer','driver');
   insert into drivers(id,user_id,name,phone) values('team-'||auth.uid()::text,auth.uid(),i.name,i.phone) on conflict(user_id) do update set name=excluded.name,phone=excluded.phone;
  end if;
  update profiles set name=i.name where id=auth.uid() and trim(name)='';
  update company_staff_invitations set claimed_user_id=auth.uid(),claimed_at=now() where company_id=i.company_id and email=i.email;
  perform platform_log(i.company_id,'company.staff.claimed',jsonb_build_object('role',i.role));
 end loop;
 perform business_claim_access();
end $$;
revoke all on function saas_guard_invitation() from public,anon,authenticated;
create or replace function public.company_context(p_slug text) returns jsonb language plpgsql stable security definer set search_path=public as $$ declare c platform_companies;r text;begin
 select * into c from platform_companies where slug=p_slug and active;if not found then raise exception 'Company unavailable';end if;r=company_role(c.id);
 if coalesce(r,'') not in ('company_admin','supervisor','field_agent') then raise exception 'Company membership required';end if;
 return (case when r='company_admin' then to_jsonb(c) else to_jsonb(c)-'brand_draft' end)||jsonb_build_object('billing_access',saas_access(c.id));
end $$;
