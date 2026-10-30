-- Temporary, service-role-only migration bridge. Removed after verified import.
create function public.ms_import(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin
 if payload->>'action'='cleanup_tests' then
  delete from ms_private.sessions where user_id in(select id from ms_private.users where email like '%@ms-qa.invalid');
  delete from ms_private.orders where user_id in(select id from ms_private.users where email like '%@ms-qa.invalid');
  delete from ms_private.users where email like '%@ms-qa.invalid';
  delete from ms_private.photos where product_id='qa-stock';
  delete from ms_private.variants where product_id='qa-stock';
  delete from ms_private.products where id='qa-stock';
  return '{"ok":true}';
 end if;
 if exists(select 1 from ms_private.users) or exists(select 1 from ms_private.products) then raise exception 'Import already performed; refusing overwrite';end if;
 for x in select value from jsonb_array_elements(payload->'users') loop
  insert into ms_private.users values((x->>'id')::uuid,x->>'name',x->>'email',x->>'password',x->>'role',(x->>'created')::timestamptz);
 end loop;
 for x in select value from jsonb_array_elements(payload->'products') loop
  insert into ms_private.products values(x->>'id',x->>'name',x->>'type',x->>'wash',x->>'image',x->>'description',coalesce((x->>'version')::integer,0));
 end loop;
 for x in select value from jsonb_array_elements(payload->'variants') loop
  insert into ms_private.variants values(x->>'product_id',x->>'size',(x->>'quantity')::integer);
 end loop;
 for x in select value from jsonb_array_elements(payload->'orders') loop
  insert into ms_private.orders values((x->>'id')::uuid,(x->>'user_id')::uuid,(x->>'items')::jsonb,x->>'status',(x->>'created')::timestamptz,(x->>'stock_reserved')::integer);
 end loop;
 for x in select value from jsonb_array_elements(payload->'photos') loop
  insert into ms_private.photos values((x->>'id')::uuid,x->>'product_id',x->>'file');
 end loop;
 return jsonb_build_object('users',(select count(*) from ms_private.users),'products',(select count(*) from ms_private.products),'orders',(select count(*) from ms_private.orders),'photos',(select count(*) from ms_private.photos));
end $$;
revoke all on function public.ms_import(jsonb) from public,anon,authenticated;
grant execute on function public.ms_import(jsonb) to service_role;
