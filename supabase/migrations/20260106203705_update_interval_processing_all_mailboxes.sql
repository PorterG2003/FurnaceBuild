-- ============================================
-- Migration: Update interval processing for all mailboxes per interval
-- ============================================
-- Changes:
-- 1. Allow all mailboxes to get jobs in the same interval (not one per interval)
-- 2. Only mark interval as "processed" when all jobs are 'sent' or 'failed'
-- 3. Don't update last_processed_interval_end in assign function
-- 4. Add function to check and update processed intervals

-- ============================================
-- 1. Update assign_message_job_to_interval function
-- ============================================
-- Now allows all mailboxes to get jobs in the same interval
-- Does NOT update last_processed_interval_end (that's done separately)

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
  v_last_processed_end TIMESTAMPTZ;
  v_total_mailboxes INTEGER;
  v_jobs_in_interval INTEGER;
BEGIN
  -- Step 0: Lock campaign row and get last_processed_interval_end
  -- This ensures sequential processing: only process intervals after the last processed one
  SELECT c.last_processed_interval_end 
  INTO v_last_processed_end
  FROM campaigns c
  WHERE c.id = p_campaign_id
  FOR UPDATE; -- Lock campaign row to prevent concurrent updates
  
  -- If campaign not found, return empty
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Step 1: Atomically lock next available interval that comes after last processed
  -- If last_processed_end is NULL, this is the first interval - allow any available interval
  -- Look for intervals that are either 'available' OR 'scheduled' (if not all mailboxes have jobs yet)
  WITH next_interval AS (
    SELECT ci.id, ci.interval_start, ci.interval_end, ci.status
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.interval_start > NOW() -- Only future intervals
      AND (v_last_processed_end IS NULL OR ci.interval_start >= v_last_processed_end) -- Sequential check
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
  -- Check if all mailboxes now have jobs
  SELECT COUNT(DISTINCT cm.mailbox_id) INTO v_total_mailboxes
  FROM campaign_mailboxes cm
  WHERE cm.campaign_id = p_campaign_id;
  
  SELECT COUNT(DISTINCT mj.mailbox_id) INTO v_jobs_in_interval
  FROM message_jobs mj
  WHERE mj.interval_id = v_interval_id
    AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed');
  
  UPDATE campaign_intervals
  SET 
    status = 'scheduled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;
  
  -- Step 7: Return new job
  -- NOTE: We do NOT update last_processed_interval_end here
  -- That's done separately by check_and_update_processed_intervals function
  -- when all jobs in the interval are 'sent' or 'failed'
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

COMMENT ON FUNCTION assign_message_job_to_interval IS 'Atomically locks interval, checks mailbox, and creates message_job. Allows all mailboxes to get jobs in the same interval. Sequential processing: only processes intervals after last processed (where all jobs are sent/failed).';

-- ============================================
-- 2. Create function to check and update processed intervals
-- ============================================
-- Checks if intervals have all jobs sent/failed and updates last_processed_interval_end
-- Should be called periodically (e.g., by send worker after updating job status)

CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL -- NULL = check all campaigns
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_campaign_record RECORD;
  v_interval_record RECORD;
  v_total_mailboxes INTEGER;
  v_completed_jobs INTEGER;
  v_interval_end TIMESTAMPTZ;
BEGIN
  -- Loop through campaigns
  FOR v_campaign_record IN
    SELECT DISTINCT c.id, c.last_processed_interval_end
    FROM campaigns c
    WHERE (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND EXISTS (
        SELECT 1 FROM campaign_intervals ci WHERE ci.campaign_id = c.id
      )
  LOOP
    -- Get total mailboxes for this campaign
    SELECT COUNT(*) INTO v_total_mailboxes
    FROM campaign_mailboxes
    WHERE campaign_id = v_campaign_record.id;
    
    -- If no mailboxes, skip
    IF v_total_mailboxes = 0 THEN
      CONTINUE;
    END IF;
    
    -- Find intervals where all jobs are 'sent' or 'failed'
    -- and interval_end > last_processed_interval_end
    FOR v_interval_record IN
      SELECT 
        ci.id,
        ci.interval_end,
        COUNT(DISTINCT mj.mailbox_id) FILTER (
          WHERE mj.status IN ('sent', 'failed')
        ) as completed_mailboxes
      FROM campaign_intervals ci
      INNER JOIN message_jobs mj ON mj.interval_id = ci.id
      WHERE ci.campaign_id = v_campaign_record.id
        AND ci.status = 'scheduled'
        AND (
          v_campaign_record.last_processed_interval_end IS NULL
          OR ci.interval_end > v_campaign_record.last_processed_interval_end
        )
      GROUP BY ci.id, ci.interval_end
      HAVING COUNT(DISTINCT mj.mailbox_id) FILTER (
        WHERE mj.status IN ('sent', 'failed')
      ) = v_total_mailboxes
      ORDER BY ci.interval_end ASC
    LOOP
      -- Update last_processed_interval_end to this interval's end
      UPDATE campaigns
      SET last_processed_interval_end = v_interval_record.interval_end
      WHERE id = v_campaign_record.id
        AND (
          last_processed_interval_end IS NULL
          OR last_processed_interval_end < v_interval_record.interval_end
        );
      
      -- Mark interval as completed
      UPDATE campaign_intervals
      SET status = 'completed'
      WHERE id = v_interval_record.id;
      
      v_updated_count := v_updated_count + 1;
    END LOOP;
  END LOOP;
  
  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_update_processed_intervals IS 'Checks intervals where all jobs are sent/failed and updates last_processed_interval_end. Should be called periodically or after job status updates.';

