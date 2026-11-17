create function public.tenant_claim_initialization(p_reference text) returns jsonb language plpgsql security definer set search_path=public as $$ declare cid uuid;o orders;a payment_initializations;begin
 cid=tenant_payment_company(p_reference);if cid is null then raise exception 'Unknown tenant payment';end if;perform set_config('app.tenant_id',cid::text,true);
 select * into o from orders where company_id=cid and reference=p_reference for update;
 if o.status<>'awaiting_payment' or o.expires_at<=now() then raise exception 'Order no longer payable';end if;
 select * into a from payment_initializations where company_id=cid and reference=p_reference;
 if found then if a.status='ready' then return jsonb_build_object('url',a.authorization_url);else raise exception 'Payment initialization requires reconciliation';end if;end if;
 insert into payment_initializations(company_id,reference,status) values(cid,p_reference,'initializing');return jsonb_build_object('claimed',true);
end $$;
create function public.tenant_save_initialization(p_reference text,p_url text) returns void language plpgsql security definer set search_path=public as $$ declare cid uuid;begin
 if p_url is null or p_url!~'^https://checkout[.]paystack[.]com/[A-Za-z0-9_-]+$' then raise exception 'Invalid provider URL';end if;
 cid=tenant_payment_company(p_reference);if cid is null then raise exception 'Unknown tenant payment';end if;perform set_config('app.tenant_id',cid::text,true);
 update payment_initializations set status='ready',authorization_url=p_url where company_id=cid and reference=p_reference and status='initializing';if not found then raise exception 'Payment initialization unavailable';end if;
end $$;
alter function tenant_claim_initialization(text) owner to edge_tenant_executor;alter function tenant_save_initialization(text,text) owner to edge_tenant_executor;
revoke all on function tenant_claim_initialization(text),tenant_save_initialization(text,text) from public,anon,authenticated;
grant execute on function tenant_claim_initialization(text),tenant_save_initialization(text,text) to service_role;
grant execute on all functions in schema public to edge_legacy_executor,edge_tenant_executor;

-- Preserve public RPC grants while keeping raw implementations private.
select tenant_install_context_wrapper('public.tenant_claim_initialization(text)'::regprocedure);
select tenant_install_context_wrapper('public.tenant_save_initialization(text,text)'::regprocedure);
