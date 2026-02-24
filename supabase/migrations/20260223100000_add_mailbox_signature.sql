-- Add optional signature column to mailboxes
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS signature TEXT;

COMMENT ON COLUMN mailboxes.signature IS 'Plain-text email signature appended to outgoing messages. Converted to HTML at send time.';
