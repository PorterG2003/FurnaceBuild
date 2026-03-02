-- Fix: check_mailbox_throttle_and_reserve was not including account_id when creating
-- a new mailbox_throttles row. After add_account_id_to_child_tables, mailbox_throttles
-- has account_id NOT NULL, so the INSERT fails with a NOT NULL constraint violation
-- for any mailbox that doesn't yet have a throttle row for today.
-- The account_id is available from the mailboxes JOIN already present in the SELECT.

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
    AND mj.status = 'reserved'
  FOR UPDATE;

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
  FOR UPDATE;

  -- Create throttle record if doesn't exist, pulling account_id and limits from mailbox
  IF NOT FOUND THEN
    INSERT INTO mailbox_throttles (
      mailbox_id,
      account_id,
      date,
      sent_count,
      hourly_sent,
      daily_limit,
      hourly_limit,
      min_gap_seconds
    )
    SELECT
      v_mailbox_id,
      m.account_id,
      v_today,
      0,
      '{}'::JSONB,
      COALESCE(m.daily_limit, 50),
      COALESCE(m.hourly_limit, 10),
      COALESCE(m.min_gap_seconds, 180)
    FROM mailboxes m
    WHERE m.id = v_mailbox_id
    ON CONFLICT (mailbox_id, date) DO NOTHING
    RETURNING * INTO v_throttle;

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
    UPDATE message_jobs
    SET status = 'cancelled',
        error_message = 'Daily throttle limit exceeded',
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, 'Daily throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  -- Step 4: Check hourly limit
  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);
  IF (v_hourly_count >= COALESCE(v_throttle.hourly_limit, 10)) THEN
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
      UPDATE message_jobs
      SET status = 'cancelled',
          error_message = 'Minimum gap between sends not met',
          updated_at = NOW()
      WHERE id = p_message_job_id;
      RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Step 6: Update throttle counters
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

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
