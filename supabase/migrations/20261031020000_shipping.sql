alter table ms_private.orders add column if not exists shipping jsonb;
create or replace function public.ms_shipping(action text,payload jsonb default '{}'::jsonb,session_token text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare session_data jsonb;
begin
 if action='get_config' then
  return coalesce((select value from ms_private.settings where key='shipping_config'),'{}'::jsonb);
 end if;
 session_data=public.ms_store('session','{}',session_token);
 if session_data->'user' is null or session_data->'user'='null'::jsonb then raise exception 'Entre na sua conta para continuar.';end if;
 if session_data->>'adminAuthenticated' is distinct from 'true' then raise exception 'Acesso exclusivo da administração.';end if;
 if action='save_config' then
  insert into ms_private.settings values('shipping_config',payload) on conflict(key) do update set value=excluded.value;
  return payload;
 end if;
 raise exception 'Rota não encontrada.';
end $$;
revoke all on function public.ms_shipping(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ms_shipping(text,jsonb,text) to service_role;
do $$
declare definition text;
begin
 definition=pg_get_functiondef('public.ms_store(text,jsonb,text)'::regprocedure);
 if position('insert into ms_private.orders values(newid,u.id,items,''Salvo'',now(),1);' in definition)>0 then
  definition=replace(
   definition,
   'insert into ms_private.orders values(newid,u.id,items,''Salvo'',now(),1);',
   'insert into ms_private.orders(id,user_id,items,status,created,stock_reserved,shipping) values(newid,u.id,items,''Salvo'',now(),1,payload->''shipping'');'
  );
  execute definition;
 end if;
end $$;
