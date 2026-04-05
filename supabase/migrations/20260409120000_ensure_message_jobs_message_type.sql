-- Repair: message_type is required by RPCs and app filters. Some databases may lack it
-- if built from a partial migration history or restored backup.
ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS message_type TEXT;

UPDATE message_jobs
SET message_type = 'campaign'
WHERE message_type IS NULL;

ALTER TABLE message_jobs
  ALTER COLUMN message_type SET DEFAULT 'campaign';

ALTER TABLE message_jobs
  ALTER COLUMN message_type SET NOT NULL;

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_message_type_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_message_type_check
  CHECK (message_type IN ('campaign', 'inbox_reply', 'inbox_forward'));

CREATE INDEX IF NOT EXISTS idx_message_jobs_message_type
  ON message_jobs(message_type);
