-- Legacy buyer sessions could be issued without proof of mailbox ownership.
-- Reject old-style buyer session writes before removing the existing rows.
alter table ms_private.sessions add constraint ms_verified_customer_sessions
  check (access_scope = 'admin' or token ~ '^v2:[0-9a-f]{64}$') not valid;

delete from ms_private.sessions s
where s.token !~ '^v2:[0-9a-f]{64}$'
  and not exists (
    select 1 from ms_private.users u
    where u.id = s.user_id and u.role = 'admin' and s.access_scope = 'admin'
  );

alter table ms_private.sessions validate constraint ms_verified_customer_sessions;

create table ms_private.legacy_account_recovery (
  user_id uuid primary key references ms_private.users(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null,
  expires_at timestamptz not null
);
alter table ms_private.legacy_account_recovery enable row level security;
revoke all on ms_private.legacy_account_recovery from public, anon, authenticated, service_role;

-- Only the store backend can issue or consume challenges. The browser never calls this RPC.
create function public.ms_legacy_recovery(action text, payload jsonb, session_token text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account ms_private.users;
  requested_email text := payload->>'email';
  code_hash text := payload->>'code_hash';
  new_password text := payload->>'password_hash';
begin
  if action not in ('start', 'finish') or action is null
    or coalesce(code_hash, '') !~ '^[0-9a-f]{64}$'
    or requested_email is null or char_length(requested_email) > 160 then
    return 'null'::jsonb;
  end if;

  select u.* into account from ms_private.users u
  where u.email = requested_email and u.role = 'customer' and u.password = ''
    and not exists (
      select 1 from ms_private.users other
      where other.id <> u.id and lower(btrim(other.email)) = u.email
    )
  for update of u;
  if not found then return 'null'::jsonb; end if;

  if action = 'start' then
    insert into ms_private.legacy_account_recovery (user_id, token_hash, sent_at, expires_at)
    values (account.id, code_hash, now(), now() + interval '15 minutes')
    on conflict (user_id) do update
      set token_hash = excluded.token_hash, sent_at = excluded.sent_at, expires_at = excluded.expires_at
      where ms_private.legacy_account_recovery.sent_at <= now() - interval '1 minute';
    if not found then return 'null'::jsonb; end if;
    return jsonb_build_object('email', account.email);
  end if;

  if coalesce(new_password, '') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' then
    return 'null'::jsonb;
  end if;
  delete from ms_private.legacy_account_recovery
  where user_id = account.id and token_hash = code_hash and expires_at > now();
  if not found then return 'null'::jsonb; end if;

  update ms_private.users set password = new_password where id = account.id;
  delete from ms_private.sessions where user_id = account.id;
  return '{"ok":true}'::jsonb;
end;
$$;
revoke all on function public.ms_legacy_recovery(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.ms_legacy_recovery(text, jsonb, text) to service_role;
