-- ============================================
-- Migration: Supabase Auth -> public.users sync trigger
-- When a user signs up via Supabase Auth, create a matching public.users row.
-- ============================================

-- Allow new users (from trigger) to omit external_id; existing rows keep it.
-- (PostgreSQL UNIQUE allows multiple NULLs, so no constraint change needed.)
ALTER TABLE users ALTER COLUMN external_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, created_at, updated_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', ''),
    now(),
    now()
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
