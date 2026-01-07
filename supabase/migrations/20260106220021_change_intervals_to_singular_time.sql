-- ============================================
-- Migration: Change intervals from start/end to singular time
-- ============================================
-- Changes campaign_intervals from interval_start/interval_end to interval_time
-- interval_time is the base time for jitter calculation

-- Drop functions that reference interval_start/interval_end first
-- They will be recreated in subsequent migrations with the new structure
DROP FUNCTION IF EXISTS assign_message_job_to_interval(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT
);

-- Add new column
ALTER TABLE campaign_intervals 
  ADD COLUMN IF NOT EXISTS interval_time TIMESTAMPTZ;

-- Migrate existing data: use interval_start as interval_time
UPDATE campaign_intervals 
SET interval_time = interval_start 
WHERE interval_time IS NULL;

-- Make interval_time NOT NULL after migration
ALTER TABLE campaign_intervals 
  ALTER COLUMN interval_time SET NOT NULL;

-- Drop old constraint
ALTER TABLE campaign_intervals 
  DROP CONSTRAINT IF EXISTS campaign_intervals_time_check;

-- Update unique constraint
ALTER TABLE campaign_intervals 
  DROP CONSTRAINT IF EXISTS campaign_intervals_campaign_id_interval_start_key;
  
ALTER TABLE campaign_intervals 
  ADD CONSTRAINT campaign_intervals_campaign_id_interval_time_key 
  UNIQUE(campaign_id, interval_time);

-- Update indexes
DROP INDEX IF EXISTS idx_campaign_intervals_campaign_start;
DROP INDEX IF EXISTS idx_campaign_intervals_status_start;

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_time 
  ON campaign_intervals(campaign_id, interval_time);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_status_time 
  ON campaign_intervals(status, interval_time) 
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_status_time 
  ON campaign_intervals(campaign_id, status, interval_time);

-- Drop old columns (after ensuring interval_time is populated)
ALTER TABLE campaign_intervals 
  DROP COLUMN IF EXISTS interval_start,
  DROP COLUMN IF EXISTS interval_end;

-- Update comments
COMMENT ON COLUMN campaign_intervals.interval_time IS 'Base time for this interval. Jitter is calculated from this time using campaign sending_interval_seconds. Scheduled times can be before this time (negative jitter).';

