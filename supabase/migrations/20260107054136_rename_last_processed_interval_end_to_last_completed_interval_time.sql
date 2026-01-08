-- ============================================
-- Migration: Rename last_processed_interval_end to last_completed_interval_time
-- ============================================
-- Better name that accurately reflects what it represents:
-- - It tracks the time of the last COMPLETED interval (not "processed" which is ambiguous)
-- - It stores interval_time (not an "end" since intervals use singular time)
-- - Matches the 'completed' status name

-- Rename the column
ALTER TABLE campaigns 
  RENAME COLUMN last_processed_interval_end TO last_completed_interval_time;

-- Update the index name (if it exists)
DROP INDEX IF EXISTS idx_campaigns_last_processed;
CREATE INDEX IF NOT EXISTS idx_campaigns_last_completed_interval_time 
  ON campaigns(id, last_completed_interval_time);

-- Update the comment
COMMENT ON COLUMN campaigns.last_completed_interval_time IS 
  'The interval_time of the last completed interval for this campaign. Intervals with interval_time > this value can be processed. NULL means no intervals completed yet (first interval can be any available interval).';

-- Now update all functions that reference the old name
-- 1. assign_message_job_to_interval
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
  -- Sequential check: only allow intervals where all previous intervals are completed
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
      -- More resilient than global cursor - checks directly if previous intervals are done
      -- NOTE: This was fixed in migration 20260108175930_fix_sequential_check_exclude_past_intervals.sql
      -- to exclude past intervals from blocking
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_intervals ci_prev
        WHERE ci_prev.campaign_id = ci.campaign_id
          AND ci_prev.interval_time < ci.interval_time
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
  -- (not via last_completed_interval_time). The check_and_update_processed_intervals
  -- function still updates last_completed_interval_time for informational purposes.
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
  'Atomically locks interval, checks mailbox, and creates message_job. Sequential processing: only assigns to intervals where all previous intervals are completed (checks directly, not via global cursor). More resilient - self-healing if jobs complete. Multiple mailboxes can share the same interval. Uses UPDATE with subquery for correct FOR UPDATE SKIP LOCKED behavior.';

-- 2. check_and_update_processed_intervals
CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL -- NULL = check all campaigns
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_campaign_record RECORD;
  v_interval_record RECORD;
  v_total_eligible_mailboxes INTEGER;
BEGIN
  FOR v_campaign_record IN
    SELECT DISTINCT c.id, c.last_completed_interval_time
    FROM campaigns c
    WHERE (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND EXISTS (SELECT 1 FROM campaign_intervals ci WHERE ci.campaign_id = c.id)
  LOOP
    -- Count eligible mailboxes for this campaign
    SELECT COUNT(*) INTO v_total_eligible_mailboxes
    FROM campaign_mailboxes cm
    JOIN mailboxes m ON m.id = cm.mailbox_id
    WHERE cm.campaign_id = v_campaign_record.id
      AND m.status = 'connected'
      AND m.smtp_status = 'active';

    IF v_total_eligible_mailboxes = 0 THEN
      CONTINUE;
    END IF;

    -- Intervals are processed only if:
    -- 1) Each eligible mailbox has at least one job in the interval
    -- 2) ALL jobs in the interval (for ANY mailbox) are 'sent' or 'failed'
    --    (no pending/reserved/sending jobs allowed)
    FOR v_interval_record IN
      SELECT
        ci.id,
        ci.interval_time
      FROM campaign_intervals ci
      WHERE ci.campaign_id = v_campaign_record.id
        AND ci.status = 'scheduled'
        AND (
          v_campaign_record.last_completed_interval_time IS NULL
          OR ci.interval_time > v_campaign_record.last_completed_interval_time
        )
        -- 1) Ensure each eligible mailbox has at least one job in this interval
        AND (
          SELECT COUNT(DISTINCT cm.mailbox_id)
          FROM campaign_mailboxes cm
          JOIN mailboxes m ON m.id = cm.mailbox_id
          JOIN message_jobs mj ON mj.mailbox_id = cm.mailbox_id AND mj.interval_id = ci.id
          WHERE cm.campaign_id = ci.campaign_id
            AND m.status = 'connected'
            AND m.smtp_status = 'active'
        ) = v_total_eligible_mailboxes
        -- 2) Ensure ALL jobs in the interval are completed (sent/failed)
        --    This checks ALL jobs, not just eligible mailboxes
        AND NOT EXISTS (
          SELECT 1
          FROM message_jobs mj
          WHERE mj.interval_id = ci.id
            AND mj.status NOT IN ('sent', 'failed')
        )
      ORDER BY ci.interval_time ASC
    LOOP
      -- Advance pointer
      UPDATE campaigns
      SET last_completed_interval_time = v_interval_record.interval_time
      WHERE id = v_campaign_record.id
        AND (
          last_completed_interval_time IS NULL
          OR last_completed_interval_time < v_interval_record.interval_time
        );

      -- Mark interval completed
      UPDATE campaign_intervals
      SET status = 'completed'
      WHERE id = v_interval_record.id;

      v_updated_count := v_updated_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_update_processed_intervals IS
  'Marks interval completed only when: (1) every eligible mailbox (connected + smtp_status=active) has at least one job in the interval, and (2) ALL jobs in the interval (for any mailbox) are sent/failed (no pending/reserved/sending jobs). Updates last_completed_interval_time to interval_time.';

