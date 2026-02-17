-- ============================================
-- Migration: Add reason to block_list
-- ============================================
-- Records why an entry was blocked: e.g. 'bounced' (auto from hard bounce), 'manual' (user-added).

ALTER TABLE block_list
  ADD COLUMN IF NOT EXISTS reason TEXT;

COMMENT ON COLUMN block_list.reason IS 'Why blocked: bounced (auto from hard bounce), manual (user-added), etc.';

CREATE INDEX IF NOT EXISTS idx_block_list_account_reason ON block_list(account_id, reason);
