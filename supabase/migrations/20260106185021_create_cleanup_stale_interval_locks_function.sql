-- ============================================
-- Migration: Create cleanup_stale_interval_locks function
-- ============================================
-- Releases intervals that have been locked for too long (stale locks)
-- Should be run periodically (e.g., every 5 minutes)
--
-- Why we need locked_at even with atomic function:
-- 1. Database connection lost mid-transaction → lock left in place
-- 2. Database deadlock → lock held until resolved
-- 3. Long-running function → lock held for duration
-- 4. Database crash/recovery → locks may not be released
--
-- locked_at is REQUIRED for this function to work

CREATE OR REPLACE FUNCTION cleanup_stale_interval_locks(
  p_lock_timeout_minutes INTEGER DEFAULT 5
)
RETURNS INTEGER AS $$
DECLARE
  v_released_count INTEGER;
BEGIN
  -- Release intervals locked for more than timeout
  -- locked_at is REQUIRED here - we need to know how long lock has been held
  UPDATE campaign_intervals
  SET 
    status = 'available',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE status = 'locked'
    AND locked_at < NOW() - (p_lock_timeout_minutes || ' minutes')::INTERVAL;
  
  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  
  RETURN v_released_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_stale_interval_locks IS 'Releases intervals that have been locked for longer than the timeout. Prevents deadlocks from crashed workers. REQUIRES locked_at field to determine lock age.';

