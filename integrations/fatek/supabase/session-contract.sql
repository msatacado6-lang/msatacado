-- Dedicated store project only. Never run on the CRM Supabase project.
DO $isolation$
BEGIN
  IF to_regclass('public."Tenant"') IS NOT NULL OR to_regclass('public."StorefrontBuyer"') IS NOT NULL THEN
    RAISE EXCEPTION 'This migration requires a separate store project, never the CRM database';
  END IF;
END;
$isolation$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE private.storefront_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.storefront_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.storefront_admins FROM PUBLIC, anon, authenticated;

-- PostgREST verifies the JWT before this executes. Check the session row as well,
-- so logout/revocation/deletion do not rely only on the JWT expiration window.
CREATE FUNCTION private.storefront_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  claims jsonb := auth.jwt();
  caller uuid := auth.uid();
  sid uuid;
  identity record;
BEGIN
  IF caller IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated'
    OR NOT coalesce((claims->'aud'='"authenticated"'::jsonb OR (jsonb_typeof(claims->'aud')='array' AND claims->'aud' ? 'authenticated')),false)
    OR coalesce(claims->>'session_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR coalesce(claims->>'exp','') !~ '^[0-9]{1,12}$'
  THEN RETURN jsonb_build_object('active',false); END IF;
  IF (claims->>'exp')::bigint <= extract(epoch FROM now()) THEN RETURN jsonb_build_object('active',false); END IF;
  sid := (claims->>'session_id')::uuid;
  SELECT u.id,u.email,u.email_confirmed_at,u.raw_user_meta_data
  INTO identity FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
  WHERE u.id=caller AND s.id=sid AND u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND (s.not_after IS NULL OR s.not_after>now());
  IF NOT FOUND THEN RETURN jsonb_build_object('active',false); END IF;
  RETURN jsonb_build_object(
    'active',true,'subject',identity.id,'sessionId',sid,'issuer',claims->>'iss',
    'email',lower(identity.email),'emailVerifiedAt',identity.email_confirmed_at,
    'name',left(coalesce(nullif(trim(identity.raw_user_meta_data->>'name'),''),split_part(identity.email,'@',1)),120),
    'admin',EXISTS(SELECT 1 FROM private.storefront_admins a WHERE a.user_id=caller AND a.active)
  );
END;
$$;
REVOKE ALL ON FUNCTION private.storefront_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.storefront_context() TO authenticated;
CREATE FUNCTION public.storefront_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT private.storefront_context(); $$;
REVOKE ALL ON FUNCTION public.storefront_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storefront_context() TO authenticated;

CREATE FUNCTION private.storefront_admin_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT coalesce((private.storefront_context()->>'admin')::boolean,false); $$;
REVOKE ALL ON FUNCTION private.storefront_admin_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.storefront_admin_active() TO authenticated;

CREATE TABLE public.storefront_content (
  key text PRIMARY KEY CHECK (key IN ('brand','banners','home','catalog_overrides')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content)='object' AND octet_length(content::text)<=65536),
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.storefront_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^storefront/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif)$'),
  alt text NOT NULL DEFAULT '' CHECK (length(alt)<=160),
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp','image/avif')),
  size_bytes integer NOT NULL CHECK (size_bytes>0 AND size_bytes<=10485760),
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.storefront_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_content,public.storefront_media FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.storefront_content,public.storefront_media TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.storefront_content,public.storefront_media TO authenticated;
CREATE POLICY published_content ON public.storefront_content FOR SELECT TO anon,authenticated USING (published);
CREATE POLICY admin_content ON public.storefront_content FOR ALL TO authenticated USING ((SELECT private.storefront_admin_active())) WITH CHECK ((SELECT private.storefront_admin_active()));
CREATE POLICY published_media ON public.storefront_media FOR SELECT TO anon,authenticated USING (published);
CREATE POLICY admin_media ON public.storefront_media FOR ALL TO authenticated USING ((SELECT private.storefront_admin_active())) WITH CHECK ((SELECT private.storefront_admin_active()));
