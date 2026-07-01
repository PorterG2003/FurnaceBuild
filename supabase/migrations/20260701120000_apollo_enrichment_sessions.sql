-- ============================================
-- Migration: Apollo enrichment sessions (async phone reveal)
-- ============================================
-- Tracks in-flight and completed Apollo enrichments per lead. Phones arrive
-- asynchronously via webhook; sync profile fields are stored on match.
-- Re-enrich is blocked while status = pending_phone (partial unique index).

CREATE TABLE IF NOT EXISTS apollo_enrichment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  global_lead_id text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (
    status IN ('pending_phone', 'complete', 'no_phone', 'no_match', 'failed', 'expired')
  ),
  sync_suggestion jsonb,
  phone_numbers jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apollo_enrichment_sessions_account_lead_idx
  ON apollo_enrichment_sessions (account_id, global_lead_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS apollo_enrichment_sessions_pending_unique
  ON apollo_enrichment_sessions (account_id, global_lead_id)
  WHERE status = 'pending_phone';

COMMENT ON TABLE apollo_enrichment_sessions IS
  'Apollo enrichment session state. Sync suggestion stored on match; mobile phones updated via webhook.';

-- ---------------------------------------------------------------------------
-- RLS: account members SELECT only; writes via service role (Lambda).
-- ---------------------------------------------------------------------------
ALTER TABLE apollo_enrichment_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "apollo_enrichment_sessions_select_member" ON apollo_enrichment_sessions
  FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_apollo_enrichment_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apollo_enrichment_sessions_updated_at ON apollo_enrichment_sessions;
CREATE TRIGGER apollo_enrichment_sessions_updated_at
  BEFORE UPDATE ON apollo_enrichment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_apollo_enrichment_sessions_updated_at();
