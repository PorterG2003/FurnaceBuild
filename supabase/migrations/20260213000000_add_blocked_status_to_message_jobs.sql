-- Add 'blocked' status to message_jobs for block-list outcomes.
-- Blocked leads get status 'blocked' instead of 'cancelled' for clearer semantics and handling.

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_status_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_status_check
  CHECK (status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked'));

COMMENT ON COLUMN message_jobs.status IS 'pending|reserved|sending|sent|failed|cancelled|blocked. blocked = lead on block list, not sent.';
