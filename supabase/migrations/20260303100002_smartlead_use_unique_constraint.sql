-- Replace partial unique indexes with non-partial UNIQUE constraints
-- so Supabase upsert ON CONFLICT (smartlead_campaign_id) works.
-- PostgreSQL UNIQUE allows multiple NULLs.

DROP INDEX IF EXISTS idx_campaigns_smartlead_campaign_id;
DROP INDEX IF EXISTS idx_leads_smartlead_lead_id;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_smartlead_campaign_id_key UNIQUE (smartlead_campaign_id);

ALTER TABLE leads
  ADD CONSTRAINT leads_smartlead_lead_id_key UNIQUE (smartlead_lead_id);
