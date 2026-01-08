-- ============================================
-- Migration: Fix sequential check to exclude past intervals
-- ============================================
-- Issue: Past intervals (already passed) were blocking future intervals
-- Fix: Only check for incomplete intervals that are in the future (>= NOW())
-- Past intervals that weren't completed don't block future assignments

CREATE OR REPLACE FUNCTION assign_message_job_to_interval(
  p_enrollment_id UUID,
  p_campaign_id UUID,
  p_lead_id UUID,
  p_mailbox_id UUID,
  p_node_id UUID,
  p_message_data JSONB,
  p_jitter_percentage NUMERIC DEFAULT 10.0,
  p_worker_id TEXT DEFAULT 'scheduler'
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  interval_id UUID,
  status TEXT,
  scheduled_at TIMESTAMPTZ,
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_new_job BOOLEAN
) AS $$
DECLARE
  v_interval_id UUID;
  v_interval_time TIMESTAMPTZ;
  v_existing_job_id UUID;
  v_new_job_id UUID;
  v_scheduled_at TIMESTAMPTZ;
  v_interval_duration_seconds INTEGER;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
BEGIN
  -- Get campaign interval duration for jitter calculation
  SELECT c.sending_interval_seconds
  INTO v_interval_duration_seconds
  FROM campaigns c
  WHERE c.id = p_campaign_id;
  
  -- If campaign not found, return empty
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Step 1: Atomically lock the FIRST available/scheduled interval
  -- Sequential check: only allow intervals where all previous FUTURE intervals are completed
  -- Past intervals (already passed) don't block future assignments
  -- This is more resilient than using a global cursor - self-healing if jobs complete
  UPDATE campaign_intervals
  SET 
    status = 'locked',
    locked_at = NOW(),
    locked_by = p_worker_id,
    updated_at = NOW()
  WHERE campaign_intervals.id = (
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.interval_time > NOW() -- Only future intervals
      -- Sequential check: no incomplete FUTURE intervals before this one
      -- Past intervals don't block future ones - only check intervals >= NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_intervals ci_prev
        WHERE ci_prev.campaign_id = ci.campaign_id
          AND ci_prev.interval_time < ci.interval_time
          AND ci_prev.interval_time >= NOW() -- Only check future intervals, past ones don't block
          AND ci_prev.status != 'completed'
        ORDER BY ci_prev.interval_time DESC
        LIMIT 1
      )
      AND (
        ci.status = 'available' -- New interval, no jobs yet
        OR (
          ci.status = 'scheduled' -- Has some jobs, check if this mailbox already has a job
          AND NOT EXISTS (
            -- Check if this specific mailbox already has a job in this interval
            SELECT 1
            FROM message_jobs mj
            WHERE mj.interval_id = ci.id
              AND mj.mailbox_id = p_mailbox_id
              AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
          )
        )
      )
    ORDER BY ci.interval_time ASC -- FIRST interval only
    LIMIT 1
    FOR UPDATE SKIP LOCKED -- Prevent concurrent locks
  )
  RETURNING 
    campaign_intervals.id,
    campaign_intervals.interval_time
  INTO v_interval_id, v_interval_time;
  
  -- If no interval was locked, return empty
  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Check if mailbox already has job in this interval (atomic check)
  SELECT mj.id INTO v_existing_job_id
  FROM message_jobs mj
  WHERE mj.mailbox_id = p_mailbox_id
    AND mj.interval_id = v_interval_id
    AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
  LIMIT 1
  FOR UPDATE; -- Lock the row if it exists
  
  -- Step 3: If mailbox already has job, return existing job and release interval
  IF v_existing_job_id IS NOT NULL THEN
    -- Release interval lock (mark as scheduled since it has jobs)
    UPDATE campaign_intervals
    SET 
      status = 'scheduled',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = NOW()
    WHERE campaign_intervals.id = v_interval_id;
    
    -- Return existing job
    RETURN QUERY
    SELECT 
      mj.id,
      mj.enrollment_id,
      mj.campaign_id,
      mj.lead_id,
      mj.mailbox_id,
      mj.node_id,
      mj.interval_id,
      mj.status,
      mj.scheduled_at,
      mj.message_data,
      mj.created_at,
      mj.updated_at,
      false AS is_new_job
    FROM message_jobs mj
    WHERE mj.id = v_existing_job_id;
    
    RETURN;
  END IF;
  
  -- Step 4: Mailbox doesn't have job - calculate scheduled_at with jitter
  -- Jitter is calculated from interval_time ± (interval_duration * jitter_percentage / 2)
  -- This allows negative jitter (scheduled before interval_time)
  v_jitter_range_seconds := v_interval_duration_seconds * (p_jitter_percentage / 100.0);
  
  -- Random jitter: -jitter_range to +jitter_range
  v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
  
  -- Scheduled time = interval_time + jitter (can be before interval_time)
  v_scheduled_at := v_interval_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;
  
  -- NO CLAMPING - allow negative jitter (scheduled before interval_time)
  
  -- Step 5: Create new message_job
  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    lead_id,
    mailbox_id,
    node_id,
    interval_id,
    scheduled_at,
    status,
    message_data
  )
  VALUES (
    p_enrollment_id,
    p_campaign_id,
    p_lead_id,
    p_mailbox_id,
    p_node_id,
    v_interval_id,
    v_scheduled_at,
    'pending',
    p_message_data
  )
  RETURNING message_jobs.id INTO v_new_job_id;
  
  -- Step 6: Mark interval as scheduled and release lock
  UPDATE campaign_intervals
  SET 
    status = 'scheduled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;
  
  -- Step 7: Return new job
  -- NOTE: Sequential processing is enforced by checking previous intervals directly
  -- (not via last_completed_interval_time). Past intervals don't block future ones.
  RETURN QUERY
  SELECT 
    mj.id,
    mj.enrollment_id,
    mj.campaign_id,
    mj.lead_id,
    mj.mailbox_id,
    mj.node_id,
    mj.interval_id,
    mj.status,
    mj.scheduled_at,
    mj.message_data,
    mj.created_at,
    mj.updated_at,
    true AS is_new_job
  FROM message_jobs mj
  WHERE mj.id = v_new_job_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assign_message_job_to_interval IS 
  'Atomically locks interval, checks mailbox, and creates message_job. Sequential processing: only assigns to intervals where all previous FUTURE intervals are completed (past intervals don''t block). More resilient - self-healing if jobs complete. Multiple mailboxes can share the same interval. Uses UPDATE with subquery for correct FOR UPDATE SKIP LOCKED behavior.';

