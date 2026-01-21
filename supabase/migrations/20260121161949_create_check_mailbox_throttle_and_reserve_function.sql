-- ============================================
-- Migration: Create check_mailbox_throttle_and_reserve function
-- ============================================
-- This migration creates an atomic throttle checking function for message jobs.
--
-- The function atomically checks throttle limits and updates counters:
-- 1. Locks message_job and mailbox_throttles (SELECT FOR UPDATE)
-- 2. Checks throttle limits (daily, hourly, min_gap)
-- 3. If all checks pass: Updates throttle counters, returns success
-- 4. If any check fails: Cancels job (status = 'cancelled'), returns failure
--
-- This ensures:
-- - No race conditions when multiple workers process jobs for the same mailbox
-- - Throttle limits enforced atomically
-- - Failed jobs are cancelled immediately (no rescheduling)

CREATE OR REPLACE FUNCTION check_mailbox_throttle_and_reserve(
  p_message_job_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  failure_reason TEXT
) AS $$
DECLARE
  v_message_job RECORD;
  v_mailbox_id UUID;
  v_throttle RECORD;
  v_today DATE;
  v_current_hour INTEGER;
  v_hourly_count INTEGER;
  v_time_since_last_send INTERVAL;
BEGIN
  -- Step 1: Lock and load message_job
  SELECT 
    mj.id,
    mj.mailbox_id,
    mj.status
  INTO v_message_job
  FROM message_jobs mj
  WHERE mj.id = p_message_job_id
    AND mj.status = 'reserved'  -- Only check throttle for reserved jobs
  FOR UPDATE;  -- Lock the job row
  
  -- If job not found or not in 'reserved' status, return failure
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Job not found or not in reserved status'::TEXT;
    RETURN;
  END IF;
  
  v_mailbox_id := v_message_job.mailbox_id;
  v_today := CURRENT_DATE;
  v_current_hour := EXTRACT(HOUR FROM NOW())::INTEGER;
  
  -- Step 2: Get or create throttle record (with lock)
  SELECT * INTO v_throttle
  FROM mailbox_throttles
  WHERE mailbox_id = v_mailbox_id
    AND date = v_today
  FOR UPDATE;  -- Lock the throttle row
  
  -- Create throttle record if doesn't exist (with defaults)
  IF NOT FOUND THEN
    INSERT INTO mailbox_throttles (
      mailbox_id,
      date,
      sent_count,
      hourly_sent,
      daily_limit,
      hourly_limit,
      min_gap_seconds
    )
    VALUES (
      v_mailbox_id,
      v_today,
      0,
      '{}'::JSONB,
      50,  -- Default daily limit
      10,  -- Default hourly limit
      180  -- Default min gap (3 minutes)
    )
    ON CONFLICT (mailbox_id, date) DO NOTHING
    RETURNING * INTO v_throttle;
    
    -- If still not found (race condition), select again
    IF NOT FOUND THEN
      SELECT * INTO v_throttle
      FROM mailbox_throttles
      WHERE mailbox_id = v_mailbox_id
        AND date = v_today
      FOR UPDATE;
    END IF;
  END IF;
  
  -- Step 3: Check daily limit
  IF (v_throttle.sent_count >= COALESCE(v_throttle.daily_limit, 50)) THEN
    -- Daily limit exceeded - cancel job
    UPDATE message_jobs
    SET status = 'cancelled',
        error_message = 'Daily throttle limit exceeded',
        updated_at = NOW()
    WHERE id = p_message_job_id;
    
    RETURN QUERY SELECT false, 'Daily throttle limit exceeded'::TEXT;
    RETURN;
  END IF;
  
  -- Step 4: Check hourly limit (get count for current hour from JSONB)
  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);
  
  IF (v_hourly_count >= COALESCE(v_throttle.hourly_limit, 10)) THEN
    -- Hourly limit exceeded - cancel job
    UPDATE message_jobs
    SET status = 'cancelled',
        error_message = 'Hourly throttle limit exceeded',
        updated_at = NOW()
    WHERE id = p_message_job_id;
    
    RETURN QUERY SELECT false, 'Hourly throttle limit exceeded'::TEXT;
    RETURN;
  END IF;
  
  -- Step 5: Check min gap
  IF (v_throttle.last_sent_at IS NOT NULL) THEN
    v_time_since_last_send := NOW() - v_throttle.last_sent_at;
    
    IF (v_time_since_last_send < INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180)) THEN
      -- Min gap not met - cancel job
      UPDATE message_jobs
      SET status = 'cancelled',
          error_message = 'Minimum gap between sends not met',
          updated_at = NOW()
      WHERE id = p_message_job_id;
      
      RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
      RETURN;
    END IF;
  END IF;
  
  -- Step 6: All throttle checks passed - update throttle counters atomically
  UPDATE mailbox_throttles
  SET sent_count = sent_count + 1,
      hourly_sent = jsonb_set(
        COALESCE(hourly_sent, '{}'::JSONB),
        ARRAY[v_current_hour::TEXT],
        to_jsonb(v_hourly_count + 1)
      ),
      last_sent_at = NOW(),
      updated_at = NOW()
  WHERE mailbox_id = v_mailbox_id
    AND date = v_today;
  
  -- Return success
  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION check_mailbox_throttle_and_reserve IS 
  'Atomically checks mailbox throttle limits for a reserved message job. Locks both message_job and mailbox_throttles to prevent race conditions. If throttle checks pass, updates throttle counters. If any check fails, cancels the job and returns failure reason. Returns success boolean and failure_reason text.';
