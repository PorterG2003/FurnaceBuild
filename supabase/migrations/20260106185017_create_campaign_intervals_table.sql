-- ============================================
-- Migration: Create campaign_intervals table
-- ============================================
-- Pre-created time slots for campaigns
-- Scheduler locks intervals and assigns one message_job per mailbox per interval

CREATE TABLE IF NOT EXISTS campaign_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Interval time boundaries
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'available', 
    -- 'available': Ready to be locked
    -- 'locked': Currently being processed by a scheduler
    -- 'scheduled': Has message_jobs assigned
    -- 'completed': All jobs sent (optional, for cleanup)
  
  -- Locking information
  locked_at TIMESTAMPTZ, -- Timestamp when lock was acquired (for stale lock detection)
  locked_by TEXT, -- Worker instance ID or process identifier (for debugging)
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT campaign_intervals_status_check 
    CHECK (status IN ('available', 'locked', 'scheduled', 'completed')),
  CONSTRAINT campaign_intervals_time_check 
    CHECK (interval_end > interval_start),
  
  -- One interval per campaign per start time
  UNIQUE(campaign_id, interval_start)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_status 
  ON campaign_intervals(campaign_id, status, interval_start);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_start 
  ON campaign_intervals(campaign_id, interval_start);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_status_start 
  ON campaign_intervals(status, interval_start) 
  WHERE status = 'available';

-- Comments
COMMENT ON TABLE campaign_intervals IS 'Pre-created time slots for campaigns. Scheduler locks intervals and assigns one message_job per mailbox per interval.';
COMMENT ON COLUMN campaign_intervals.status IS 'available: Ready to lock, locked: Being processed, scheduled: Has jobs, completed: All sent';
COMMENT ON COLUMN campaign_intervals.locked_by IS 'Worker instance identifier for debugging and stale lock detection';

