-- Add per-mailbox throttle config. When creating a new mailbox_throttles row,
-- the RPC will use these values (falling back to 180, 50, 10 if null).
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS min_gap_seconds INTEGER DEFAULT 180,
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS hourly_limit INTEGER DEFAULT 10;

COMMENT ON COLUMN mailboxes.min_gap_seconds IS 'Minimum seconds between sends from this mailbox (used when creating mailbox_throttles rows). Default 180.';
COMMENT ON COLUMN mailboxes.daily_limit IS 'Max sends per day for this mailbox (used when creating mailbox_throttles rows). Default 50.';
COMMENT ON COLUMN mailboxes.hourly_limit IS 'Max sends per hour for this mailbox (used when creating mailbox_throttles rows). Default 10.';
