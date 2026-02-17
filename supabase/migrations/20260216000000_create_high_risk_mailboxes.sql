-- ============================================
-- Migration: Create high_risk_mailboxes table
-- ============================================
-- Master table for marking mailboxes as high-risk (bounce rate, manual, complaint, etc.)
-- Used for visibility and reporting only; scheduler does not exclude high-risk mailboxes.

CREATE TABLE IF NOT EXISTS high_risk_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active risk per mailbox (resolved_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_high_risk_mailboxes_mailbox_active
  ON high_risk_mailboxes(mailbox_id) WHERE resolved_at IS NULL;

-- List high-risk mailboxes for account (e.g. senders UI)
CREATE INDEX IF NOT EXISTS idx_high_risk_mailboxes_account_resolved
  ON high_risk_mailboxes(account_id, resolved_at);

CREATE TRIGGER update_high_risk_mailboxes_updated_at
  BEFORE UPDATE ON high_risk_mailboxes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE high_risk_mailboxes IS 'Mailboxes marked as high-risk for visibility and reporting. Reason and details stored; scheduler does not exclude these.';
COMMENT ON COLUMN high_risk_mailboxes.reason IS 'e.g. high_bounce_rate, manual, complaint, blocklisted_domain';
COMMENT ON COLUMN high_risk_mailboxes.details IS 'Optional JSON: bounce_rate, threshold, admin note, etc.';
COMMENT ON COLUMN high_risk_mailboxes.resolved_at IS 'NULL = currently high-risk; set when cleared to keep history.';
