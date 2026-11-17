-- PostgreSQL searches the temporary schema first unless it is explicitly placed
-- after trusted schemas. Keep temporary tables from shadowing privileged lookups.
-- Preserve function ownership, grants and other SET clauses (including tenant context).
revoke create on schema public from public,anon,authenticated;
do $$ declare r record;begin
 for r in select p.oid::regprocedure::text signature from pg_proc p
 where p.pronamespace='public'::regnamespace and 'search_path=public'=any(p.proconfig) loop
  execute format('alter function %s set search_path=public,pg_temp',r.signature);
 end loop;
end $$;
