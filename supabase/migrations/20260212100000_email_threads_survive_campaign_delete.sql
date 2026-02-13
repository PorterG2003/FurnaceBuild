-- Prevent campaign or mailbox deletion from wiping master inbox threads.
-- CASCADE -> SET NULL so threads remain (filtered by account_id); optional FKs become NULL.
-- Likely cause of "inbox wiped": deleting a mailbox on Senders page (or campaign delete).

-- 1) campaign_id: deleting a campaign no longer deletes its threads
ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_campaign_id_fkey;

ALTER TABLE email_threads
  ALTER COLUMN campaign_id DROP NOT NULL;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_threads.campaign_id IS 'Campaign that started this thread. NULL if campaign was deleted (thread kept for inbox history).';

-- 2) mailbox_id: deleting a mailbox (e.g. Senders page) no longer deletes its threads
ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_mailbox_id_fkey;

ALTER TABLE email_threads
  ALTER COLUMN mailbox_id DROP NOT NULL;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_mailbox_id_fkey
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_threads.mailbox_id IS 'Mailbox that received/sent this thread. NULL if mailbox was deleted (thread kept for inbox history).';

-- 3) message_job_id: deleting the original sent job (e.g. via campaign delete or cleanup) no longer deletes the thread
ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_message_job_id_fkey;

ALTER TABLE email_threads
  ALTER COLUMN message_job_id DROP NOT NULL;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_message_job_id_fkey
  FOREIGN KEY (message_job_id) REFERENCES message_jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_threads.message_job_id IS 'Original sent message_job that started this thread. NULL if job was deleted (thread kept for inbox history).';

-- 4) lead_id: deleting a lead no longer deletes its inbox threads
ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_lead_id_fkey;

ALTER TABLE email_threads
  ALTER COLUMN lead_id DROP NOT NULL;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_threads.lead_id IS 'Lead in this conversation. NULL if lead was deleted (thread kept for inbox history).';

-- 5) enrollment_id: deleting an enrollment no longer deletes its thread
ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_enrollment_id_fkey;

ALTER TABLE email_threads
  ALTER COLUMN enrollment_id DROP NOT NULL;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_enrollment_id_fkey
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_threads.enrollment_id IS 'Enrollment for this thread. NULL if enrollment was deleted (thread kept for inbox history).';
