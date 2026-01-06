-- ============================================
-- Migration: Create release_campaign_interval function
-- ============================================
-- Releases a locked interval (for error handling only)
-- Note: The assign_message_job_to_interval function handles normal release
-- This is only needed if we need to manually release a lock (e.g., on error)

CREATE OR REPLACE FUNCTION release_campaign_interval(
  p_interval_id UUID,
  p_new_status TEXT DEFAULT 'available'
)
RETURNS VOID AS $$
BEGIN
  -- Validate status
  IF p_new_status NOT IN ('available', 'scheduled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;
  
  -- Release the lock
  UPDATE campaign_intervals
  SET 
    status = p_new_status,
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE id = p_interval_id
    AND status = 'locked'; -- Only release if currently locked
  
  IF NOT FOUND THEN
    RAISE WARNING 'Interval % was not locked or does not exist', p_interval_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION release_campaign_interval IS 'Releases a locked interval (for error handling). Normal flow uses assign_message_job_to_interval which handles release automatically.';

