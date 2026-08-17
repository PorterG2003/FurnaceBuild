-- Per-user, per-account UI preferences (jsonb bag).
-- Inbox default filter lives at settings.inboxDefaultFilter.
-- Do not reuse notification_preferences (event x channel routing).

CREATE TABLE public.user_account_preferences (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id),
  CONSTRAINT user_account_preferences_settings_object_check
    CHECK (jsonb_typeof(settings) = 'object')
);

CREATE INDEX user_account_preferences_account_idx
  ON public.user_account_preferences (account_id);

COMMENT ON TABLE public.user_account_preferences IS
  'Client-owned UI preferences keyed by user + account. Keys live in settings jsonb (e.g. inboxDefaultFilter).';

CREATE TRIGGER update_user_account_preferences_updated_at
  BEFORE UPDATE ON public.user_account_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.user_account_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_account_preferences_select ON public.user_account_preferences
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE POLICY user_account_preferences_insert ON public.user_account_preferences
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE POLICY user_account_preferences_update ON public.user_account_preferences
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE POLICY user_account_preferences_delete ON public.user_account_preferences
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_account_preferences TO authenticated;
