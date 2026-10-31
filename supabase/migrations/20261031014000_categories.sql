create table ms_private.categories(id uuid primary key default gen_random_uuid(),name text not null check(char_length(name) between 2 and 60),created timestamptz not null default now());
create unique index categories_unique_name on ms_private.categories(lower(name));
alter table ms_private.categories enable row level security;
insert into ms_private.categories(name) select distinct type from ms_private.products on conflict do nothing;
create function ms_private.validate_category() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from ms_private.categories where name=new.type) then raise exception 'Selecione uma categoria cadastrada.';end if;
 return new;
end $$;
create trigger product_category before insert or update of type on ms_private.products for each row execute function ms_private.validate_category();
create function public.ms_categories(action text,payload jsonb default '{}'::jsonb,session_token text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare session_data jsonb; category_name text; result jsonb;
begin
 if action='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'productCount',(select count(*) from ms_private.products p where p.type=c.name)) order by c.name) from ms_private.categories c),'[]');end if;
 session_data=public.ms_store('session','{}',session_token);
 if session_data->'user' is null or session_data->'user'='null'::jsonb then raise exception 'Entre na sua conta para continuar.';end if;
 if session_data->>'adminAuthenticated' is distinct from 'true' then raise exception 'Acesso exclusivo da administração.';end if;
 if action='create' then
  category_name=regexp_replace(trim(payload->>'name'),'\s+',' ','g');
  if category_name is null or char_length(category_name) not between 2 and 60 or lower(category_name)='todos' then raise exception 'Use um nome de categoria entre 2 e 60 caracteres, diferente de Todos.';end if;
  begin
   insert into ms_private.categories(name) values(category_name) returning jsonb_build_object('id',id,'name',name,'productCount',0) into result;
  exception when unique_violation then raise exception 'Essa categoria já está cadastrada.';
  end;
  return result;
 end if;
 raise exception 'Rota não encontrada.';
end $$;
revoke all on function public.ms_categories(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ms_categories(text,jsonb,text) to service_role;
revoke all on function ms_private.validate_category() from public,anon,authenticated;
