-- ============================================
-- Backfill campaigns.created_at for Smartlead imports
-- ============================================
-- Smartlead migrations stored the origin date in smartlead_created_at but
-- wrote migration time into created_at. Copy the Smartlead timestamp so list
-- sort, detail display, and API default stats windows use the real origin date.

UPDATE campaigns
SET
  created_at = smartlead_created_at,
  updated_at = NOW()
WHERE source = 'smartlead'
  AND smartlead_created_at IS NOT NULL
  AND created_at IS DISTINCT FROM smartlead_created_at;

UPDATE campaigns c
SET
  created_at = smc.smartlead_created_at,
  smartlead_created_at = COALESCE(c.smartlead_created_at, smc.smartlead_created_at),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (furnace_campaign_id)
    furnace_campaign_id,
    smartlead_created_at
  FROM smartlead_migration_campaigns
  WHERE furnace_campaign_id IS NOT NULL
    AND smartlead_created_at IS NOT NULL
  ORDER BY furnace_campaign_id, finished_at DESC NULLS LAST, updated_at DESC
) smc
WHERE c.id = smc.furnace_campaign_id
  AND c.source = 'smartlead'
  AND c.created_at IS DISTINCT FROM smc.smartlead_created_at;
