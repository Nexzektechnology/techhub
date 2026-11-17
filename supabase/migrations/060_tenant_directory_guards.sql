-- Trigger inputs belong to the row's company, including when a trusted worker
-- updates stock. An archived flagship brand must never affect another company.
create or replace function public.guard_deleted_directory() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if tg_table_name='products' then
  if tg_op='UPDATE' then
   if new.category_id is not distinct from old.category_id and new.brand is not distinct from old.brand then return new;end if;
  end if;
 end if;
 if new.company_id<>'10000000-0000-4000-8000-000000000001' and company_role(new.company_id) is null then raise exception 'Forbidden';end if;
 if tg_table_name='products' then
  perform 1 from categories where company_id=new.company_id and id=new.category_id for share;
  if exists(select 1 from categories where company_id=new.company_id and id=new.category_id and archived_at is not null) and(tg_op='INSERT' or new.category_id is distinct from old.category_id) then raise exception 'Restore the category before assigning products';end if;
  perform 1 from brands where company_id=new.company_id and name=new.brand for share;
  if exists(select 1 from brands where company_id=new.company_id and name=new.brand and archived_at is not null) and(tg_op='INSERT' or new.brand is distinct from old.brand) then raise exception 'Restore the brand before assigning products';end if;
 elsif tg_table_name='categories' then
  perform 1 from categories where company_id=new.company_id and id=new.parent_id for share;
  if new.parent_id is not null and exists(select 1 from categories where company_id=new.company_id and id=new.parent_id and archived_at is not null) then raise exception 'Restore the parent category first';end if;
  if tg_op='UPDATE' and old.archived_at is not null and new.archived_at is not null and new is distinct from old then raise exception 'Restore this category before editing';end if;
 elsif tg_table_name='brands' then
  if new.archived_at is not null and new.active then raise exception 'Restore this brand before publishing';end if;
  if tg_op='UPDATE' and old.archived_at is not null and new.archived_at is not null and new is distinct from old then raise exception 'Restore this brand before editing';end if;
 elsif tg_table_name in ('gallery_media','content_pages','coupons') then
  if exists(select 1 from admin_record_trash where company_id=new.company_id and kind=case tg_table_name when 'gallery_media' then 'gallery' when 'content_pages' then 'pages' else 'coupons' end and id=new.id) then raise exception 'Restore this record before editing';end if;
 elsif tg_table_name='website_content' then
  if exists(select 1 from admin_record_trash where company_id=new.company_id and kind=new.kind and id=new.id) then raise exception 'Restore this record before editing';end if;
 end if;return new;
end $$;
create or replace function public.check_category_hierarchy() returns trigger language plpgsql set search_path=public as $$
declare ancestor text:=new.parent_id;seen text[]:=array[new.id];level integer:=0;span integer;begin
 perform pg_advisory_xact_lock(hashtextextended('category-hierarchy:'||new.company_id::text,0));
 while ancestor is not null loop
  if ancestor=any(seen) then raise exception 'Category parents cannot form a circle';end if;seen=array_append(seen,ancestor);level=level+1;
  if level>2 then raise exception 'Use at most three category levels';end if;
  select parent_id into ancestor from categories where company_id=new.company_id and id=ancestor;if not found then raise exception 'Parent category does not exist';end if;
 end loop;
 with recursive descendants as(select id,1 depth,array[new.id,id] path from categories where company_id=new.company_id and parent_id=new.id union all select c.id,d.depth+1,d.path||c.id from categories c join descendants d on c.parent_id=d.id where c.company_id=new.company_id and d.depth<3 and not c.id=any(d.path)) select coalesce(max(depth),0) into span from descendants;
 if level+span>2 then raise exception 'Moving this category would exceed three levels';end if;return new;
end $$;
