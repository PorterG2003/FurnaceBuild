-- Smartlead leads are campaign-specific (see leads table comment).
-- Replace global UNIQUE(smartlead_lead_id) with per-campaign uniqueness so the same
-- Smartlead lead id can exist in different imported campaigns without overwriting rows.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_smartlead_lead_id_key;

ALTER TABLE leads
  ADD CONSTRAINT leads_campaign_id_smartlead_lead_id_key
  UNIQUE (campaign_id, smartlead_lead_id);

COMMENT ON CONSTRAINT leads_campaign_id_smartlead_lead_id_key ON leads IS
  'One Furnace lead row per Smartlead lead within a campaign. Allows the same person across multiple imported campaigns.';
