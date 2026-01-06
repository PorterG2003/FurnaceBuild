-- ============================================
-- Migration: Add interval_id to message_jobs
-- ============================================
-- Track which interval a message_job belongs to
-- Helps with debugging and ensures one mailbox per interval

ALTER TABLE message_jobs 
  ADD COLUMN IF NOT EXISTS interval_id UUID REFERENCES campaign_intervals(id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_interval_id 
  ON message_jobs(interval_id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_mailbox_interval 
  ON message_jobs(mailbox_id, interval_id) 
  WHERE interval_id IS NOT NULL;

COMMENT ON COLUMN message_jobs.interval_id IS 'Campaign interval this message_job belongs to. Ensures one mailbox per interval.';

