-- Add account_id to child tables for RLS (denormalization)
-- Pattern: add column -> backfill from parent -> NOT NULL -> index

-- 1. leads
ALTER TABLE leads ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE leads l SET account_id = c.account_id FROM campaigns c WHERE l.campaign_id = c.id;
ALTER TABLE leads ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_account_id ON leads(account_id);

-- 2. nodes
ALTER TABLE nodes ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE nodes n SET account_id = c.account_id FROM campaigns c WHERE n.campaign_id = c.id;
ALTER TABLE nodes ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nodes_account_id ON nodes(account_id);

-- 3. enrollments
ALTER TABLE enrollments ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE enrollments e SET account_id = c.account_id FROM campaigns c WHERE e.campaign_id = c.id;
ALTER TABLE enrollments ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_account_id ON enrollments(account_id);

-- 4. message_jobs
ALTER TABLE message_jobs ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE message_jobs m SET account_id = c.account_id FROM campaigns c WHERE m.campaign_id = c.id;
ALTER TABLE message_jobs ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_jobs_account_id ON message_jobs(account_id);

-- 5. events
ALTER TABLE events ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE events e SET account_id = c.account_id FROM campaigns c WHERE e.campaign_id = c.id;
ALTER TABLE events ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_account_id ON events(account_id);

-- 6. campaign_stats
ALTER TABLE campaign_stats ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE campaign_stats cs SET account_id = c.account_id FROM campaigns c WHERE cs.campaign_id = c.id;
ALTER TABLE campaign_stats ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_stats_account_id ON campaign_stats(account_id);

-- 7. campaign_mailboxes
ALTER TABLE campaign_mailboxes ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE campaign_mailboxes cm SET account_id = c.account_id FROM campaigns c WHERE cm.campaign_id = c.id;
ALTER TABLE campaign_mailboxes ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_mailboxes_account_id ON campaign_mailboxes(account_id);

-- 8. campaign_intervals
ALTER TABLE campaign_intervals ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE campaign_intervals ci SET account_id = c.account_id FROM campaigns c WHERE ci.campaign_id = c.id;
ALTER TABLE campaign_intervals ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_intervals_account_id ON campaign_intervals(account_id);

-- 9. email_messages (via email_threads)
ALTER TABLE email_messages ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE email_messages em SET account_id = t.account_id FROM email_threads t WHERE em.thread_id = t.id;
ALTER TABLE email_messages ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_account_id ON email_messages(account_id);

-- 10. thread_tag_assignments (via thread_tags on tag_id)
ALTER TABLE thread_tag_assignments ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE thread_tag_assignments tta SET account_id = tt.account_id FROM thread_tags tt WHERE tta.tag_id = tt.id;
ALTER TABLE thread_tag_assignments ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_thread_tag_assignments_account_id ON thread_tag_assignments(account_id);

-- 11. mailbox_throttles (via mailboxes)
ALTER TABLE mailbox_throttles ADD COLUMN account_id UUID REFERENCES accounts(id);
UPDATE mailbox_throttles mt SET account_id = m.account_id FROM mailboxes m WHERE mt.mailbox_id = m.id;
ALTER TABLE mailbox_throttles ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mailbox_throttles_account_id ON mailbox_throttles(account_id);
