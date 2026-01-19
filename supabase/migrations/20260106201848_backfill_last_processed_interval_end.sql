-- ============================================
-- Migration: Backfill last_processed_interval_end for existing campaigns
-- ============================================
-- Sets last_processed_interval_end to the end time of the latest scheduled interval
-- for campaigns that already have scheduled intervals

UPDATE campaigns c
SET last_processed_interval_end = (
  SELECT MAX(ci.interval_end)
  FROM campaign_intervals ci
  WHERE ci.campaign_id = c.id
    AND ci.status = 'scheduled'
)
WHERE EXISTS (
  SELECT 1
  FROM campaign_intervals ci
  WHERE ci.campaign_id = c.id
    AND ci.status = 'scheduled'
);

COMMENT ON COLUMN campaigns.last_processed_interval_end IS 
  'The interval_time of the last processed interval for this campaign. Intervals with interval_time >= this value can be processed. NULL means no intervals processed yet (first interval can be any available interval).';

