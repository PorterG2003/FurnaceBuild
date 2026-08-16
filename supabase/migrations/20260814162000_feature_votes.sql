-- Per-user product votes (changeable). RLS: users manage only their own rows.

CREATE TABLE IF NOT EXISTS public.feature_votes (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  choice TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_feature_votes_account_id ON public.feature_votes(account_id);
CREATE INDEX IF NOT EXISTS idx_feature_votes_topic ON public.feature_votes(topic);

ALTER TABLE public.feature_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_votes_select_own"
  ON public.feature_votes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "feature_votes_insert_own"
  ON public.feature_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE POLICY "feature_votes_update_own"
  ON public.feature_votes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE POLICY "feature_votes_delete_own"
  ON public.feature_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
