-- ============================================
-- Migration: Create block_list table
-- ============================================
-- Block list prevents campaign/automated emails from being sent to blocked
-- addresses or domains. Manual inbox replies and forwards are allowed.
-- Per-account; authorization enforced at application level (same as other tables).

CREATE TABLE IF NOT EXISTS block_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'domain')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, value, type)
);

CREATE INDEX IF NOT EXISTS idx_block_list_account_value ON block_list(account_id, value);
CREATE INDEX IF NOT EXISTS idx_block_list_account_type ON block_list(account_id, type);

COMMENT ON TABLE block_list IS 'Blocked email addresses and domains. Campaign emails are not sent to blocked addresses. Manual inbox sends are allowed with confirmation.';
COMMENT ON COLUMN block_list.value IS 'Email (e.g. spam@example.com) or domain (e.g. spammer.com)';
COMMENT ON COLUMN block_list.type IS 'email = exact match; domain = blocks *@value';
