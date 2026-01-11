-- ============================================
-- Migration: Fix ambiguous id in assign_message_job_to_interval
-- ============================================
-- Fixes "column reference 'id' is ambiguous" error by using CTE for interval locking

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
  v_interval_start TIMESTAMPTZ;
  v_interval_end TIMESTAMPTZ;
  v_existing_job_id UUID;
  v_new_job_id UUID;
  v_scheduled_at TIMESTAMPTZ;
  v_interval_duration_seconds NUMERIC;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
  v_base_time TIMESTAMPTZ;
BEGIN
  -- Step 1: Atomically lock next available interval using CTE to avoid ambiguity
  WITH next_interval AS (
    SELECT ci.id, ci.interval_start, ci.interval_end
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.status = 'available'
      AND ci.interval_start > NOW() -- Only future intervals
    ORDER BY ci.interval_start ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED -- Prevent concurrent locks
  )
  UPDATE campaign_intervals
  SET 
    status = 'locked',
    locked_at = NOW(),
    locked_by = p_worker_id,
    updated_at = NOW()
  FROM next_interval
  WHERE campaign_intervals.id = next_interval.id
  RETURNING 
    campaign_intervals.id,
    campaign_intervals.interval_start,
    campaign_intervals.interval_end
  INTO v_interval_id, v_interval_start, v_interval_end;
  
  -- If no interval was locked, return empty
  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Check if mailbox already has job in this interval (atomic check)
  SELECT mj.id INTO v_existing_job_id
  FROM message_jobs mj
  WHERE mj.mailbox_id = p_mailbox_id
    AND mj.interval_id = v_interval_id
    AND mj.status IN ('pending', 'reserved', 'sending')
  LIMIT 1
  FOR UPDATE; -- Lock the row if it exists
  
  -- Step 3: If mailbox already has job, return existing job and release interval
  IF v_existing_job_id IS NOT NULL THEN
    -- Release interval lock (mark as scheduled since it has a job)
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
  
  -- Step 4: Mailbox doesn't have job - calculate scheduled_at with jitter within interval
  -- Calculate base time (middle of interval)
  v_interval_duration_seconds := EXTRACT(EPOCH FROM (v_interval_end - v_interval_start));
  v_base_time := v_interval_start + (v_interval_duration_seconds / 2) * INTERVAL '1 second';
  
  -- Calculate jitter within interval bounds
  v_jitter_range_seconds := v_interval_duration_seconds * (p_jitter_percentage / 100.0);
  -- Random jitter: -jitter_range to +jitter_range
  v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
  v_scheduled_at := v_base_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;
  
  -- Clamp to interval bounds
  IF v_scheduled_at < v_interval_start THEN
    v_scheduled_at := v_interval_start;
  END IF;
  IF v_scheduled_at > v_interval_end THEN
    v_scheduled_at := v_interval_end;
  END IF;
  
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

COMMENT ON FUNCTION assign_message_job_to_interval IS 'Atomically locks interval, checks mailbox, and creates message_job. Ensures one mailbox per interval. Returns existing job if mailbox already assigned.';

