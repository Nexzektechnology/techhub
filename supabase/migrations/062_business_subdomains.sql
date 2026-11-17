-- Platform-managed subdomains need no customer DNS changes. A business URL is
-- assigned once so a released label cannot be silently taken by another tenant.
create table public.saas_subdomains(
 company_id uuid primary key references platform_companies(id),
 label text not null unique check(length(label) between 2 and 60 and label~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 created_at timestamptz not null default now(),
 check(label<>all(array['www','app','api','admin','platform','login','auth','mail','smtp','imap','pop','autodiscover','ns1','ns2','status','support','billing','cdn','static','assets','docs','help']))
);
alter table saas_subdomains enable row level security;
revoke all on saas_subdomains from public,anon,authenticated;
grant select on saas_subdomains to authenticated;
create policy saas_subdomain_owner_read on saas_subdomains for select to authenticated using(saas_member_role(company_id)='company_admin');
create function public.saas_default_subdomain() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if length(new.slug) between 2 and 60 and new.slug~'^[a-z0-9]+(-[a-z0-9]+)*$' and new.slug<>all(array['www','app','api','admin','platform','login','auth','mail','smtp','imap','pop','autodiscover','ns1','ns2','status','support','billing','cdn','static','assets','docs','help']) then
  insert into saas_subdomains(company_id,label) values(new.id,new.slug) on conflict do nothing;
 end if;return new;
end $$;
create trigger saas_assign_subdomain after insert on platform_companies for each row execute function saas_default_subdomain();
insert into saas_subdomains(company_id,label) select id,slug from platform_companies where length(slug) between 2 and 60 and slug~'^[a-z0-9]+(-[a-z0-9]+)*$' and slug<>all(array['www','app','api','admin','platform','login','auth','mail','smtp','imap','pop','autodiscover','ns1','ns2','status','support','billing','cdn','static','assets','docs','help']) on conflict do nothing;
create function public.saas_resolve_subdomain(p_label text) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select c.slug from saas_subdomains s join platform_companies c on c.id=s.company_id join tenant_storefronts f on f.company_id=c.id where s.label=p_label and c.active and f.published and tenant_commerce_enabled(c.id)
$$;
revoke all on function saas_default_subdomain(),saas_resolve_subdomain(text) from public,anon,authenticated;
grant execute on function saas_resolve_subdomain(text) to anon,authenticated;
