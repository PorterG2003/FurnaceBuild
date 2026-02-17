-- ============================================
-- Migration: Add suppress_bounced_emails to accounts
-- ============================================
-- When true (default), hard bounces are automatically added to the account block list.
-- When false, bounces are still recorded but the address is not blocked.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS suppress_bounced_emails BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN accounts.suppress_bounced_emails IS 'When true, hard bounces are auto-added to block list; when false, bounces are recorded but not blocked. Default: true.';
