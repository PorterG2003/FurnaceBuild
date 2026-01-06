-- ============================================
-- Migration: Add last_processed_interval_end to campaigns
-- ============================================
-- Tracks the end time of the last processed interval for sequential processing
-- Ensures intervals are processed in order (only process interval N if N-1 is processed)

ALTER TABLE campaigns 
  ADD COLUMN IF NOT EXISTS last_processed_interval_end TIMESTAMPTZ;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_campaigns_last_processed 
  ON campaigns(id, last_processed_interval_end);

COMMENT ON COLUMN campaigns.last_processed_interval_end IS 
  'The end time of the last processed interval for this campaign. Intervals with start >= this value can be processed. NULL means no intervals processed yet (first interval can be any available interval).';

