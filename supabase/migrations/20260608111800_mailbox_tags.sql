-- Mailbox tags: account-level tag definitions and mailbox assignments

CREATE TABLE IF NOT EXISTS mailbox_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS mailbox_tag_assignments (
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES mailbox_tags(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (mailbox_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_tags_account_id ON mailbox_tags(account_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_tag_assignments_mailbox_id ON mailbox_tag_assignments(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_tag_assignments_tag_id ON mailbox_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_tag_assignments_account_id ON mailbox_tag_assignments(account_id);

ALTER TABLE mailbox_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_member_select" ON mailbox_tags FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_insert" ON mailbox_tags FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_update" ON mailbox_tags FOR UPDATE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_delete" ON mailbox_tags FOR DELETE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_select" ON mailbox_tag_assignments FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_insert" ON mailbox_tag_assignments FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_update" ON mailbox_tag_assignments FOR UPDATE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_delete" ON mailbox_tag_assignments FOR DELETE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));
