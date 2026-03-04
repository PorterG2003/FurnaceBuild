-- Add Smartlead migration columns to campaigns and leads tables.
-- All columns are nullable so existing rows are unaffected.
-- Partial unique indexes allow upserts keyed by Smartlead ids
-- while permitting many NULLs for native Furnace rows.

-- campaigns: source, smartlead_campaign_id, smartlead_created_at
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS smartlead_campaign_id BIGINT NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS smartlead_created_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_smartlead_campaign_id
  ON campaigns (smartlead_campaign_id)
  WHERE smartlead_campaign_id IS NOT NULL;

-- leads: smartlead_lead_id
ALTER TABLE leads ADD COLUMN IF NOT EXISTS smartlead_lead_id BIGINT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_smartlead_lead_id
  ON leads (smartlead_lead_id)
  WHERE smartlead_lead_id IS NOT NULL;
