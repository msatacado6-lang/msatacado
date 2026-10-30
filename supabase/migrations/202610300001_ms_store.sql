create schema if not exists ms_private;
revoke all on schema ms_private from public, anon, authenticated;
create table ms_private.users(id uuid primary key,name text not null,email text unique not null,password text not null,role text not null check(role in ('admin','customer')),created timestamptz not null default now());
create table ms_private.sessions(token text primary key,user_id uuid references ms_private.users(id),expires bigint not null);
create table ms_private.products(id text primary key,name text not null,type text not null,wash text not null,image text not null,description text not null,version integer not null default 0);
create table ms_private.variants(product_id text references ms_private.products(id),size text not null,quantity integer not null check(quantity>=0),primary key(product_id,size));
create table ms_private.orders(id uuid primary key,user_id uuid references ms_private.users(id),items jsonb not null,status text not null,created timestamptz not null,stock_reserved integer not null default 0);
create table ms_private.photos(id uuid primary key,product_id text references ms_private.products(id),file text not null);
create table ms_private.rates(key text primary key,n integer not null,until_at timestamptz not null);
alter table ms_private.users enable row level security;
alter table ms_private.sessions enable row level security;
alter table ms_private.products enable row level security;
alter table ms_private.variants enable row level security;
alter table ms_private.orders enable row level security;
alter table ms_private.photos enable row level security;
alter table ms_private.rates enable row level security;

create function ms_private.product_json(p ms_private.products) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(p)-'version'||jsonb_build_object('inventoryVersion',p.version,'variants',coalesce((select jsonb_agg(to_jsonb(v)-'product_id' order by v.size) from ms_private.variants v where v.product_id=p.id),'[]'::jsonb),'photos',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'file',f.file,'url','/api/images/'||f.file) order by f.id) from ms_private.photos f where f.product_id=p.id),'[]'::jsonb))
$$;
create function ms_private.change_stock(items jsonb,restore boolean) returns void language plpgsql set search_path='' as $$
declare i jsonb;
begin
 for i in select value from jsonb_array_elements(items) order by value->>'id',value->>'size' loop
  if restore then
   insert into ms_private.variants values(i->>'id',i->>'size',(i->>'qty')::integer) on conflict(product_id,size) do update set quantity=ms_private.variants.quantity+excluded.quantity;
  else
   update ms_private.variants set quantity=quantity-(i->>'qty')::integer where product_id=i->>'id' and size=i->>'size' and quantity>=(i->>'qty')::integer;
   if not found then raise exception 'Estoque insuficiente para % tamanho %.',i->>'name',i->>'size'; end if;
  end if;
  update ms_private.products set version=version+1 where id=i->>'id';
 end loop;
end $$;

-- Only the server service role can execute this dispatcher. No browser key has access.
create function public.ms_store(action text,payload jsonb default '{}'::jsonb,session_token text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u ms_private.users; p ms_private.products; o ms_private.orders; f ms_private.photos; i jsonb; items jsonb='[]'; result jsonb; newid uuid; qty integer; total integer=0; seen text[]='{}'; itemkey text; n integer;
begin
 select users.* into u from ms_private.users users join ms_private.sessions s on s.user_id=users.id where s.token=session_token and s.expires>extract(epoch from now())*1000;
 if action='session' then return jsonb_build_object('user',case when u.id is null then null else to_jsonb(u)-'password'-'created' end,'setupNeeded',false); end if;
 if action='products' then return coalesce((select jsonb_agg(ms_private.product_json(x) order by x.id) from ms_private.products x),'[]'); end if;
 if action='rate' then
  insert into ms_private.rates values(payload->>'key',1,now()+interval '1 minute') on conflict(key) do update set n=case when ms_private.rates.until_at<now() then 1 else ms_private.rates.n+1 end,until_at=case when ms_private.rates.until_at<now() then now()+interval '1 minute' else ms_private.rates.until_at end returning ms_private.rates.n into n;
  delete from ms_private.rates where until_at<now()-interval '1 day';return jsonb_build_object('allowed',n<=20);
 end if;
 if action='login_lookup' then return (select to_jsonb(x) from ms_private.users x where email=payload->>'email'); end if;
 if action='register' then
  if exists(select 1 from ms_private.users where email=payload->>'email') then raise exception 'Este e-mail já está cadastrado.'; end if;
  insert into ms_private.users(id,name,email,password,role) values((payload->>'id')::uuid,payload->>'name',payload->>'email',payload->>'password','customer') returning * into u;
  return to_jsonb(u)-'password'-'created';
 end if;
 if action='create_session' then
  delete from ms_private.sessions where token=session_token or expires<extract(epoch from now())*1000;
  insert into ms_private.sessions values(payload->>'token',(payload->>'user_id')::uuid,(payload->>'expires')::bigint);return '{}'::jsonb;
 end if;
 if action='logout' then delete from ms_private.sessions where token=session_token;return '{"ok":true}';end if;
 if u.id is null then raise exception 'Entre na sua conta para continuar.';end if;
 if action='profile' then update ms_private.users set name=payload->>'name' where id=u.id returning * into u;return jsonb_build_object('user',to_jsonb(u)-'password'-'created');end if;
 if action='orders' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.created desc) from ms_private.orders x where x.user_id=u.id),'[]');end if;
 if action='order_create' then
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 30 then raise exception 'Seleção inválida.';end if;
  for i in select value from jsonb_array_elements(payload->'items') loop
   if jsonb_typeof(i->'qty') is distinct from 'number' or (i->>'qty')!~'^[0-9]+$' then raise exception 'Quantidade inválida.';end if;
   qty=(i->>'qty')::integer;itemkey=(i->>'id')||':'||(i->>'size');
   if qty not between 1 and 99 or itemkey=any(seen) then raise exception 'Peça ou quantidade inválida.';end if;
   seen=array_append(seen,itemkey);select * into p from ms_private.products where id=i->>'id';if not found then raise exception 'Produto inválido.';end if;
   items=items||jsonb_build_array(jsonb_build_object('id',p.id,'name',p.name,'image',p.image,'size',i->>'size','qty',qty));total=total+qty;
  end loop;
  if total<6 then raise exception 'O pedido mínimo é de 6 peças.';end if;
  perform ms_private.change_stock(items,false);newid=gen_random_uuid();
  insert into ms_private.orders values(newid,u.id,items,'Salvo',now(),1);return jsonb_build_object('id',newid);
 end if;
 if u.role<>'admin' then raise exception 'Acesso exclusivo da administração.';end if;
 if action='overview' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',c.name,'email',c.email) order by x.created desc) from ms_private.orders x join ms_private.users c on c.id=x.user_id),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(c)-'password'-'role' order by c.created desc) from ms_private.users c where c.role='customer'),'[]'));end if;
 if action='order_status' then
  if payload->>'status' not in ('Salvo','Em análise','Concluído','Cancelado') then raise exception 'Situação inválida.';end if;
  select * into o from ms_private.orders where id=(payload->>'id')::uuid for update;if not found then raise exception 'Pedido não encontrado.';end if;
  if o.status=payload->>'status' then return '{"ok":true}';end if;
  if payload->>'status'='Cancelado' and o.stock_reserved=1 then perform ms_private.change_stock(o.items,true);o.stock_reserved=0;
  elsif o.status='Cancelado' and payload->>'status'<>'Cancelado' then perform ms_private.change_stock(o.items,false);o.stock_reserved=1;end if;
  update ms_private.orders set status=payload->>'status',stock_reserved=o.stock_reserved where id=o.id;return '{"ok":true}';
 end if;
 if action='product_update' then
  select * into p from ms_private.products where id=payload->>'id' for update;if not found then raise exception 'Produto não encontrado.';end if;
  if payload ? 'variants' then
   if (payload->>'inventoryVersion')::integer is distinct from p.version then raise exception 'O estoque mudou. Recarregue a página antes de editar novamente.';end if;
   if jsonb_typeof(payload->'variants') is distinct from 'array' or jsonb_array_length(payload->'variants')>22 then raise exception 'Grade inválida.';end if;
   delete from ms_private.variants where product_id=p.id;
   for i in select value from jsonb_array_elements(payload->'variants') loop
    if i->>'size' !~ '^(PP|P|M|G|GG|XG|XGG|3[2468]|[45][02468]|60)$' or jsonb_typeof(i->'quantity') is distinct from 'number' or (i->>'quantity')!~'^[0-9]+$' or (i->>'quantity')::integer>99999 then raise exception 'Tamanho ou quantidade inválida.';end if;
    insert into ms_private.variants values(p.id,i->>'size',(i->>'quantity')::integer);
   end loop;
  end if;
  update ms_private.products set name=payload->>'name',type=payload->>'type',wash=payload->>'wash',description=payload->>'description',version=version+1 where id=p.id;return '{"ok":true}';
 end if;
 if action in ('photo_add','photo_cover','photo_delete') then
  select * into p from ms_private.products where id=payload->>'product_id' for update;if not found then raise exception 'Produto não encontrado.';end if;
  if action='photo_add' then
   select count(*) into n from ms_private.photos where product_id=p.id;if n>=8 then raise exception 'Limite de 8 fotos por peça.';end if;
   insert into ms_private.photos values((payload->>'id')::uuid,p.id,payload->>'file');if n=0 then update ms_private.products set image='/api/images/'||(payload->>'file') where id=p.id;end if;
  else
   select * into f from ms_private.photos where id=(payload->>'id')::uuid and product_id=p.id;if not found then raise exception 'Foto não encontrada.';end if;
   if action='photo_cover' then update ms_private.products set image='/api/images/'||f.file where id=p.id;
   else
    delete from ms_private.photos where id=f.id;
    if p.image='/api/images/'||f.file then update ms_private.products set image=coalesce((select '/api/images/'||file from ms_private.photos where product_id=p.id order by id limit 1),p.id||'.webp') where id=p.id;end if;
   end if;
  end if;
  select * into p from ms_private.products where id=p.id;return ms_private.product_json(p);
 end if;
 raise exception 'Rota não encontrada.';
end $$;
revoke all on function public.ms_store(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ms_store(text,jsonb,text) to service_role;
revoke all on all functions in schema ms_private from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ms-product-photos','ms-product-photos',false,8388608,array['image/webp']) on conflict(id) do nothing;
