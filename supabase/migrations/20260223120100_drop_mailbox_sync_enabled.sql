-- Remove sync_enabled column; sync eligibility is determined by email pattern only (*@furnace.test excluded).

DROP INDEX IF EXISTS idx_mailboxes_sync_enabled;
ALTER TABLE mailboxes DROP COLUMN IF EXISTS sync_enabled;
