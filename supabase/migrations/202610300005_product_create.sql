create or replace function public.ms_store(action text,payload jsonb default '{}'::jsonb,session_token text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u ms_private.users; p ms_private.products; o ms_private.orders; f ms_private.photos; i jsonb; items jsonb='[]'; result jsonb; newid uuid; qty integer; total integer=0; seen text[]='{}'; itemkey text; n integer;
begin
 select users.* into u from ms_private.users users join ms_private.sessions s on s.user_id=users.id where s.token=session_token and s.expires>extract(epoch from now())*1000;
 if action='session' then return jsonb_build_object('user',case when u.id is null then null else to_jsonb(u)-'password'-'created' end,'setupNeeded',false,'adminAuthenticated',coalesce(u.role='admin' and exists(select 1 from ms_private.sessions where token=session_token and access_scope='admin'),false)); end if;
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
  if payload->>'scope'='admin' and not exists(select 1 from ms_private.users where id=(payload->>'user_id')::uuid and role='admin') then raise exception 'Acesso exclusivo da administração.';end if;
  insert into ms_private.sessions(token,user_id,expires,access_scope) values(payload->>'token',(payload->>'user_id')::uuid,(payload->>'expires')::bigint,case when payload->>'scope'='admin' then 'admin' else 'customer' end);return '{}'::jsonb;
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
 if u.role<>'admin' or not exists(select 1 from ms_private.sessions where token=session_token and access_scope='admin') then raise exception 'Acesso exclusivo da administração.';end if;
 if action='overview' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('name',c.name,'email',c.email) order by x.created desc) from ms_private.orders x join ms_private.users c on c.id=x.user_id),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(c)-'password'-'role' order by c.created desc) from ms_private.users c where c.role='customer'),'[]'));end if;
 if action='order_status' then
  if payload->>'status' not in ('Salvo','Em análise','Concluído','Cancelado') then raise exception 'Situação inválida.';end if;
  select * into o from ms_private.orders where id=(payload->>'id')::uuid for update;if not found then raise exception 'Pedido não encontrado.';end if;
  if o.status=payload->>'status' then return '{"ok":true}';end if;
  if payload->>'status'='Cancelado' and o.stock_reserved=1 then perform ms_private.change_stock(o.items,true);o.stock_reserved=0;
  elsif o.status='Cancelado' and payload->>'status'<>'Cancelado' then perform ms_private.change_stock(o.items,false);o.stock_reserved=1;end if;
  update ms_private.orders set status=payload->>'status',stock_reserved=o.stock_reserved where id=o.id;return '{"ok":true}';
 end if;
 if action='product_create' then
  newid=gen_random_uuid();
  insert into ms_private.products(id,name,type,wash,image,description) values(newid::text,payload->>'name',payload->>'type',payload->>'wash','placeholder.svg',payload->>'description');
  perform public.ms_store('product_update',payload||jsonb_build_object('id',newid::text,'inventoryVersion',0,'variants',coalesce(payload->'variants','[]'::jsonb)),session_token);
  select * into p from ms_private.products where id=newid::text;return ms_private.product_json(p);
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
    if p.image='/api/images/'||f.file then update ms_private.products set image=coalesce((select '/api/images/'||file from ms_private.photos where product_id=p.id order by id limit 1),case when p.id in ('wide','reta','short') then p.id||'.webp' else 'placeholder.svg' end) where id=p.id;end if;
   end if;
  end if;
  select * into p from ms_private.products where id=p.id;return ms_private.product_json(p);
 end if;
 raise exception 'Rota não encontrada.';
end $$;
revoke all on function public.ms_store(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ms_store(text,jsonb,text) to service_role;

-- Verify the new action inside a rolled-back subtransaction; no QA records persist.
do $$
declare uid uuid=gen_random_uuid(); token text=gen_random_uuid()::text; item jsonb;
begin
 begin
  insert into ms_private.users values(uid,'Migration QA',uid::text||'@migration.invalid','unused','admin',now());
  insert into ms_private.sessions values(token,uid,(extract(epoch from now())*1000)::bigint+60000,'admin');
  item=public.ms_store('product_create',jsonb_build_object('name','Peça QA','type','Calças','wash','Azul','description','Validação temporária','variants',jsonb_build_array(jsonb_build_object('size','M','quantity',6))),token);
  if item->>'id' is null or jsonb_array_length(item->'variants')<>1 then raise exception 'Product creation verification failed';end if;
  if (item->'variants'->0->>'quantity')::integer<>6 then raise exception 'Stock verification failed';end if;
  raise exception using errcode='ZX001',message='Rollback successful verification';
 exception when sqlstate 'ZX001' then null;
 end;
end $$;
