-- ============================================
-- Migration: Create batch_assign_jobs_to_interval function
-- ============================================
-- Atomically locks interval and creates message_jobs for multiple enrollments
-- This ensures intervals are filled completely in one transaction
--
-- Parameters:
--   p_campaign_id: Campaign to process
--   p_job_data: Array of job data (enrollment_id, lead_id, mailbox_id, node_id, message_data, jitter_percentage)
--
-- Returns: Number of jobs created

CREATE OR REPLACE FUNCTION batch_assign_jobs_to_interval(
  p_campaign_id UUID,
  p_job_data JSONB[], -- Array of {enrollment_id, lead_id, mailbox_id, node_id, message_data, jitter_percentage}
  p_worker_id TEXT DEFAULT 'scheduler'
)
RETURNS TABLE (
  jobs_created INTEGER,
  interval_id UUID,
  interval_time TIMESTAMPTZ
) AS $$
DECLARE
  v_interval_id UUID;
  v_interval_time TIMESTAMPTZ;
  v_interval_duration_seconds INTEGER;
  v_job_count INTEGER := 0;
  v_job_data JSONB;
  v_enrollment_id UUID;
  v_lead_id UUID;
  v_mailbox_id UUID;
  v_node_id UUID;
  v_message_data JSONB;
  v_jitter_percentage NUMERIC;
  v_scheduled_at TIMESTAMPTZ;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
  v_existing_job_id UUID;
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
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_intervals ci_prev
        WHERE ci_prev.campaign_id = ci.campaign_id
          AND ci_prev.interval_time < ci.interval_time
          AND ci_prev.interval_time >= NOW()
          AND ci_prev.status != 'completed'
        ORDER BY ci_prev.interval_time DESC
        LIMIT 1
      )
      AND (
        ci.status = 'available' -- New interval, no jobs yet
        OR ci.status = 'scheduled' -- Has some jobs, will check mailboxes below
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
  
  -- Step 2: Process each job in p_job_data
  -- Filter to only mailboxes that don't already have a job in this interval
  FOREACH v_job_data IN ARRAY p_job_data
  LOOP
    v_enrollment_id := (v_job_data->>'enrollment_id')::UUID;
    v_lead_id := (v_job_data->>'lead_id')::UUID;
    v_mailbox_id := (v_job_data->>'mailbox_id')::UUID;
    v_node_id := (v_job_data->>'node_id')::UUID;
    v_message_data := v_job_data->'message_data';
    v_jitter_percentage := COALESCE((v_job_data->>'jitter_percentage')::NUMERIC, 10.0);
    
    -- Check if mailbox already has job in this interval
    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.mailbox_id = v_mailbox_id
      AND mj.interval_id = v_interval_id
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
    LIMIT 1
    FOR UPDATE; -- Lock the row if it exists
    
    -- Skip if mailbox already has job
    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;
    
    -- Check if enrollment already has job for this node
    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.enrollment_id = v_enrollment_id
      AND mj.node_id = v_node_id
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
    LIMIT 1
    FOR UPDATE;
    
    -- Skip if enrollment already has job for this node
    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;
    
    -- Calculate scheduled_at with jitter
    v_jitter_range_seconds := v_interval_duration_seconds * (v_jitter_percentage / 100.0);
    v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
    v_scheduled_at := v_interval_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;
    
    -- Create message_job
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
      v_enrollment_id,
      p_campaign_id,
      v_lead_id,
      v_mailbox_id,
      v_node_id,
      v_interval_id,
      v_scheduled_at,
      'pending',
      v_message_data
    );
    
    v_job_count := v_job_count + 1;
  END LOOP;
  
  -- Step 3: Mark interval as scheduled and release lock
  UPDATE campaign_intervals
  SET 
    status = 'scheduled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;
  
  -- Step 4: Return result
  RETURN QUERY
  SELECT 
    v_job_count AS jobs_created,
    v_interval_id AS interval_id,
    v_interval_time AS interval_time;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION batch_assign_jobs_to_interval IS 
  'Atomically locks first available/scheduled interval and creates message_jobs for multiple enrollments in one transaction. Ensures intervals are filled completely. Skips mailboxes/enrollments that already have jobs. Sequential processing: only assigns to intervals where all previous FUTURE intervals are completed.';

