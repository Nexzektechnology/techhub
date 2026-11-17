create function public.tenant_refresh_products(p_slug text,p_ids text[]) returns jsonb language plpgsql stable security definer set search_path=public set app.tenant_id='' as $$ declare cid uuid;wid text;begin
 if p_ids is null or cardinality(p_ids)>50 then raise exception 'Invalid product list';end if;
 select id into cid from tenant_public_company(p_slug);if not found then raise exception 'Store unavailable';end if;perform set_config('app.tenant_id',cid::text,true);
 select warehouse_id into wid from tenant_storefronts where company_id=cid and published;if not found then raise exception 'Store unavailable';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.tenant_slug,'name',p.name,'category_id',p.category_id,'brand',coalesce(nullif(p.brand,''),p.merchant_name),'merchant_id',p.merchant_id,'merchant_name',p.merchant_name,'price_kobo',p.price_kobo,'previous_price_kobo',p.previous_price_kobo,'stock',coalesce(i.on_hand,0),'reserved',coalesce(i.reserved,0),'image',p.image,'images',p.images,'description',coalesce(nullif(p.description,''),p.name),'options',p.options,'active',p.active,'featured',p.featured,'created_at',p.created_at)) from products p left join tenant_inventory i on i.company_id=p.company_id and i.product_id=p.id and i.warehouse_id=wid where p.company_id=cid and p.id=any(p_ids) and p.active and p.archived_at is null),'[]');
end $$;
alter function tenant_refresh_products(text,text[]) owner to edge_tenant_executor;
revoke all on function tenant_refresh_products(text,text[]) from public,anon,authenticated;grant execute on function tenant_refresh_products(text,text[]) to anon,authenticated;
grant execute on all functions in schema public to edge_tenant_executor;
