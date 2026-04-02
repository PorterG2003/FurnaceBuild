-- General per-user feature flags (service role writes; clients read own rows via RLS).
-- Example: flag_key = 'foundry' grants /foundry/* UI.

CREATE TABLE IF NOT EXISTS public.user_access_flags (
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_user_access_flags_user_id ON public.user_access_flags (user_id);

COMMENT ON TABLE public.user_access_flags IS
  'Keyed access flags per user (e.g. foundry). Managed via service role only; authenticated users SELECT own rows under RLS.';

ALTER TABLE public.user_access_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_access_flags_select_own"
  ON public.user_access_flags
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for authenticated — only service_role bypasses RLS.
