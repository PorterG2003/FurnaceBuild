-- Track email parsing/backfill versions for received IMAP messages.
-- 1 = original parse, 2+ = reparsed/backfilled.

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS parse_version INTEGER;

UPDATE email_messages
SET parse_version = 1
WHERE parse_version IS NULL;

ALTER TABLE email_messages
  ALTER COLUMN parse_version SET DEFAULT 1;

ALTER TABLE email_messages
  ALTER COLUMN parse_version SET NOT NULL;

ALTER TABLE email_messages
  DROP CONSTRAINT IF EXISTS email_messages_parse_version_check;

ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_parse_version_check CHECK (parse_version >= 1);

CREATE INDEX IF NOT EXISTS idx_email_messages_received_parse_version
  ON email_messages (direction, parse_version, received_at DESC)
  WHERE direction = 'received';

COMMENT ON COLUMN email_messages.parse_version IS
  'Email parser version. 1=original parse, 2+=reparsed/backfilled.';

