-- Inbox interaction logging for smart handling feedback and evaluation.

CREATE TABLE IF NOT EXISTS inbox_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  trigger_message_id uuid REFERENCES email_messages(id) ON DELETE SET NULL,
  classification_completed_at timestamptz,
  suggestion_mode text CHECK (suggestion_mode IN ('manual', 'ai')),
  suggestion_version text,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'api')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_api_key_id uuid REFERENCES account_api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  source text NOT NULL,
  intent jsonb,
  context jsonb NOT NULL,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_interactions_account_created_idx
  ON inbox_interactions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inbox_interactions_thread_created_idx
  ON inbox_interactions (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inbox_interactions_suggestion_version_created_idx
  ON inbox_interactions (suggestion_version, created_at DESC)
  WHERE suggestion_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_interactions_account_mismatch_idx
  ON inbox_interactions (account_id, created_at DESC)
  WHERE (intent->>'matched_suggestion') = 'false';

COMMENT ON TABLE inbox_interactions IS
  'Append-only inbox triage decisions with point-in-time smart handling context.';
COMMENT ON COLUMN inbox_interactions.intent IS
  'Derived intent metadata such as suggested_primary, matched_suggestion, and used_suggested_reply.';
COMMENT ON COLUMN inbox_interactions.context IS
  'Point-in-time thread, lead, and trigger message snapshot when the user or API action was recorded.';
COMMENT ON COLUMN inbox_interactions.suggestion_version IS
  'Version of smart handling logic that produced the suggestion being evaluated.';

ALTER TABLE inbox_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inbox_interactions_select ON inbox_interactions FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY inbox_interactions_insert ON inbox_interactions FOR INSERT
  WITH CHECK (
    actor_type = 'user'
    AND actor_user_id = auth.uid()
    AND account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON inbox_interactions TO authenticated;
