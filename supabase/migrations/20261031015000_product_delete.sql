create table ms_private.archived_products(product_id text primary key references ms_private.products(id));
alter table ms_private.archived_products enable row level security;
create function public.ms_delete_product(action text,payload jsonb default '{}'::jsonb,session_token text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare session_data jsonb;
begin
 session_data=public.ms_store('session','{}',session_token);
 if session_data->'user' is null or session_data->'user'='null'::jsonb then raise exception 'Entre na sua conta para continuar.';end if;
 if session_data->>'adminAuthenticated' is distinct from 'true' then raise exception 'Acesso exclusivo da administração.';end if;
 perform 1 from ms_private.products where id=payload->>'id' for update;
 if not found then raise exception 'Produto não encontrado.';end if;
 insert into ms_private.archived_products values(payload->>'id') on conflict do nothing;
 return '{"ok":true}';
end $$;
revoke all on function public.ms_delete_product(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ms_delete_product(text,jsonb,text) to service_role;
-- Patch the live definitions to preserve unrelated deployed changes.
do $$
declare definition text;
begin
 definition=pg_get_functiondef('public.ms_store(text,jsonb,text)'::regprocedure);
 if position('from ms_private.products x)' in definition)=0 then raise exception 'Unexpected product list definition';end if;
 definition=replace(definition,'from ms_private.products x)','from ms_private.products x where not exists(select 1 from ms_private.archived_products a where a.product_id=x.id))');
 execute definition;
 definition=pg_get_functiondef('public.ms_categories(text,jsonb,text)'::regprocedure);
 definition=replace(definition,'where p.type=c.name','where p.type=c.name and not exists(select 1 from ms_private.archived_products a where a.product_id=p.id)');
 execute definition;
 definition=pg_get_functiondef('ms_private.change_stock(jsonb,boolean)'::regprocedure);
 if position('for i in select value from jsonb_array_elements(items) order by value->>''id'',value->>''size'' loop' in definition)=0 then raise exception 'Unexpected stock definition';end if;
 definition=replace(definition,'for i in select value from jsonb_array_elements(items) order by value->>''id'',value->>''size'' loop',
 'for i in select value from jsonb_array_elements(items) order by value->>''id'',value->>''size'' loop
  perform 1 from ms_private.products where id=i->>''id'' for update;
  if not restore and exists(select 1 from ms_private.archived_products where product_id=i->>''id'') then raise exception ''Esta peça foi excluída do catálogo. Revise o carrinho.'';end if;');
 execute definition;
end $$;
