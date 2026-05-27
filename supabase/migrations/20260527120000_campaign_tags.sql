-- Campaign tags: account-level tag definitions and campaign assignments

CREATE TABLE IF NOT EXISTS campaign_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS campaign_tag_assignments (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES campaign_tags(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_tags_account_id ON campaign_tags(account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_tag_assignments_campaign_id ON campaign_tag_assignments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_tag_assignments_tag_id ON campaign_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_campaign_tag_assignments_account_id ON campaign_tag_assignments(account_id);

ALTER TABLE campaign_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_member_select" ON campaign_tags FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_insert" ON campaign_tags FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_update" ON campaign_tags FOR UPDATE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_delete" ON campaign_tags FOR DELETE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_select" ON campaign_tag_assignments FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_insert" ON campaign_tag_assignments FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_update" ON campaign_tag_assignments FOR UPDATE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "account_member_delete" ON campaign_tag_assignments FOR DELETE
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));
