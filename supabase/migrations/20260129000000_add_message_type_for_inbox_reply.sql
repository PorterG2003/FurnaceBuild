-- ============================================
-- Migration: Add message_type to message_jobs for inbox reply/forward
-- ============================================
-- Inbox replies (and forwards) use the same message_jobs table with
-- message_type = 'inbox_reply' | 'inbox_forward'. Campaign jobs use 'campaign'.
-- Manual jobs have interval_id = NULL and node_id = NULL.

-- Add message_type column (default 'campaign' for existing rows)
ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'campaign';

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_message_type_check;
ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_message_type_check
  CHECK (message_type IN ('campaign', 'inbox_reply', 'inbox_forward'));

-- Allow node_id to be NULL for manual (inbox) jobs
ALTER TABLE message_jobs
  ALTER COLUMN node_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_jobs_message_type
  ON message_jobs(message_type);

-- Index for manual jobs: worker claims manual first (pending, scheduled_at <= NOW())
CREATE INDEX IF NOT EXISTS idx_message_jobs_manual_pending
  ON message_jobs(scheduled_at)
  WHERE status = 'pending' AND message_type IN ('inbox_reply', 'inbox_forward');

COMMENT ON COLUMN message_jobs.message_type IS 'campaign = scheduler-created; inbox_reply | inbox_forward = user-initiated from inbox. Manual jobs have interval_id NULL, node_id NULL.';
