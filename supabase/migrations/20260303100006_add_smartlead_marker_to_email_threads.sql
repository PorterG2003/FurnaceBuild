ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS smartlead_lead_id BIGINT NULL;

ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_campaign_id_smartlead_lead_id_key;

ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_campaign_id_smartlead_lead_id_key
  UNIQUE (campaign_id, smartlead_lead_id);

CREATE INDEX IF NOT EXISTS idx_email_threads_smartlead_lead_id
  ON email_threads (smartlead_lead_id);

COMMENT ON COLUMN email_threads.smartlead_lead_id IS
  'Smartlead lead id for imported inbox threads. Non-NULL means the thread was imported from Smartlead.';
