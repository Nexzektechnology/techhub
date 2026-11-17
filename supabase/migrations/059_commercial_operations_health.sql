create function public.saas_enroll_company(p_company uuid,p_plan text) returns void language plpgsql security definer set search_path=public as $$ declare plan saas_plans;begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 if p_company='10000000-0000-4000-8000-000000000001' then raise exception 'The platform flagship retains owner-operated access';end if;
 select * into plan from saas_plans where id=p_plan and available;if not found then raise exception 'Published plan required';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_company::text,0));
 insert into saas_subscriptions(company_id,plan_id,state,period_end,grace_days) values(p_company,plan.id,case when plan.trial_days>0 then 'trialing' else 'pending' end,case when plan.trial_days>0 then now()+make_interval(days=>plan.trial_days) end,plan.grace_days)
 on conflict(company_id) do update set plan_id=excluded.plan_id,state=excluded.state,period_end=excluded.period_end,grace_days=excluded.grace_days,updated_at=now() where saas_subscriptions.state='grandfathered';
 if not found then raise exception 'An existing commercial subscription cannot be overwritten';end if;
 update platform_modules m set enabled=r.ready and exists(select 1 from saas_plan_modules pm where pm.plan_id=plan.id and pm.module=m.module) from saas_module_registry r where m.company_id=p_company and r.id=m.module;
 perform platform_log(p_company,'saas.company.enrolled',jsonb_build_object('plan',plan.id,'trial_days',plan.trial_days));
end $$;
create function public.saas_operational_health() returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if not platform_is_admin() then raise exception 'Forbidden';end if;
 return jsonb_build_object('worker',(select jsonb_build_object('last_success_at',last_success_at,'detail',detail,'recent',last_success_at>now()-interval '15 minutes') from saas_worker_heartbeats where name='billing'),
 'enabled_automatic_subscriptions',(select count(*) from saas_autopay where enabled),
 'due_charge_jobs',(select count(*) from saas_charge_jobs where state in ('queued','charging','verifying') and next_attempt_at<=now()),
 'reconciliation_jobs',(select count(*) from saas_charge_jobs where state='review'),
 'expired_active_domains',(select count(*) from platform_domains where state='active' and verified_until<=now()),
 'tables_without_rls',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity),
 'unvalidated_foreign_keys',(select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f' and not convalidated),
 'legacy_routine_boundary_violations',(select count(*) from tenant_legacy_routines m left join pg_proc p on p.oid=to_regprocedure(m.signature) where p.oid is null or pg_get_userbyid(p.proowner)<>'edge_legacy_executor' or md5(p.prosrc)<>m.source_md5),
 'unsafe_worker_grants',has_function_privilege('anon','saas_claim_charge_jobs(integer)','EXECUTE') or has_function_privilege('authenticated','saas_save_autopay(text,text,text)','EXECUTE') or pg_has_role('authenticated','edge_tenant_executor','MEMBER'));
end $$;
revoke all on function saas_enroll_company(uuid,text),saas_operational_health() from public,anon,authenticated;
grant execute on function saas_enroll_company(uuid,text),saas_operational_health() to authenticated;
