alter table ms_private.users add column if not exists phone text not null default '';
do $$
declare definition text;
begin
 definition=pg_get_functiondef('public.ms_store(text,jsonb,text)'::regprocedure);
 definition=replace(
  definition,
  'insert into ms_private.users(id,name,email,password,role) values((payload->>''id'')::uuid,payload->>''name'',payload->>''email'',payload->>''password'',''customer'') returning * into u;',
  'insert into ms_private.users(id,name,email,password,role,phone) values((payload->>''id'')::uuid,payload->>''name'',payload->>''email'',coalesce(payload->>''password'',''''),''customer'',coalesce(payload->>''phone'','''')) returning * into u;'
 );
 definition=replace(
  definition,
  'update ms_private.users set name=payload->>''name'' where id=u.id returning * into u;',
  'update ms_private.users set name=payload->>''name'',phone=coalesce(payload->>''phone'',phone) where id=u.id returning * into u;'
 );
 definition=replace(
  definition,
  'jsonb_build_object(''name'',c.name,''email'',c.email)',
  'jsonb_build_object(''name'',c.name,''email'',c.email,''phone'',c.phone)'
 );
 execute definition;
end $$;;
