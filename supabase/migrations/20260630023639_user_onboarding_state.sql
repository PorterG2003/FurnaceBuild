-- Per-user onboarding / announcement flow completion state.
-- Unlike user_access_flags (service-role writes only), the client owns these rows:
-- the app marks a flow completed/dismissed, and replaying a flow during smoke
-- testing is just deleting the row. No service involvement.

CREATE TABLE IF NOT EXISTS public.user_onboarding_state (
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL,
  flow_version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('completed', 'dismissed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, flow_id)
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_state_user_id
  ON public.user_onboarding_state (user_id);

COMMENT ON TABLE public.user_onboarding_state IS
  'Per-user onboarding/announcement flow state. Client-owned under RLS: users read/write/delete their own rows. Delete a row to replay a flow.';
COMMENT ON COLUMN public.user_onboarding_state.flow_version IS
  'Registry version of the flow when the row was written. Stored for future re-show logic.';

ALTER TABLE public.user_onboarding_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_onboarding_state'
      AND policyname = 'user_onboarding_state_select_own'
  ) THEN
    CREATE POLICY "user_onboarding_state_select_own"
      ON public.user_onboarding_state
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_onboarding_state'
      AND policyname = 'user_onboarding_state_insert_own'
  ) THEN
    CREATE POLICY "user_onboarding_state_insert_own"
      ON public.user_onboarding_state
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_onboarding_state'
      AND policyname = 'user_onboarding_state_update_own'
  ) THEN
    CREATE POLICY "user_onboarding_state_update_own"
      ON public.user_onboarding_state
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_onboarding_state'
      AND policyname = 'user_onboarding_state_delete_own'
  ) THEN
    CREATE POLICY "user_onboarding_state_delete_own"
      ON public.user_onboarding_state
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_onboarding_state TO authenticated;
