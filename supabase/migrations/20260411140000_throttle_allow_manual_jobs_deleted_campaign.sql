-- Inbox reply/forward jobs keep campaign_id from the thread; soft-deleting the campaign
-- must not cancel them (user is sending from inbox). Only mailbox_deleted_at blocks manual sends.

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
  v_parent_failure_reason TEXT;
  v_manual_inbox BOOLEAN;
BEGIN
  SELECT
    mj.id,
    mj.mailbox_id,
    mj.status,
    mj.campaign_id,
    mj.lead_id,
    mj.enrollment_id,
    mj.node_id,
    mj.message_type,
    c.deleted_at AS campaign_deleted_at,
    l.deleted_at AS lead_deleted_at,
    e.deleted_at AS enrollment_deleted_at,
    m.deleted_at AS mailbox_deleted_at,
    n.deleted_at AS node_deleted_at
  INTO v_message_job
  FROM message_jobs mj
  LEFT JOIN campaigns c ON c.id = mj.campaign_id
  LEFT JOIN leads l ON l.id = mj.lead_id
  LEFT JOIN enrollments e ON e.id = mj.enrollment_id
  LEFT JOIN mailboxes m ON m.id = mj.mailbox_id
  LEFT JOIN nodes n ON n.id = mj.node_id
  WHERE mj.id = p_message_job_id
    AND mj.status = 'reserved'
  FOR UPDATE OF mj;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Job not found or not in reserved status'::TEXT;
    RETURN;
  END IF;

  v_manual_inbox :=
    v_message_job.message_type = 'inbox_reply'
    OR v_message_job.message_type = 'inbox_forward';

  IF v_message_job.mailbox_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Mailbox deleted';
  ELSIF NOT v_manual_inbox THEN
    IF v_message_job.campaign_id IS NOT NULL AND v_message_job.campaign_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Campaign deleted';
    ELSIF v_message_job.lead_id IS NOT NULL AND v_message_job.lead_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Lead deleted';
    ELSIF v_message_job.enrollment_id IS NOT NULL AND v_message_job.enrollment_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Enrollment deleted';
    ELSIF v_message_job.node_id IS NOT NULL AND v_message_job.node_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Node deleted';
    END IF;
  END IF;

  IF v_parent_failure_reason IS NOT NULL THEN
    UPDATE message_jobs
    SET status = 'cancelled',
        reserved_at = NULL,
        error_message = v_parent_failure_reason,
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, v_parent_failure_reason;
    RETURN;
  END IF;

  v_mailbox_id := v_message_job.mailbox_id;
  v_today := CURRENT_DATE;
  v_current_hour := EXTRACT(HOUR FROM NOW())::INTEGER;

  SELECT * INTO v_throttle
  FROM mailbox_throttles
  WHERE mailbox_id = v_mailbox_id
    AND date = v_today
  FOR UPDATE;

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
      AND m.deleted_at IS NULL
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

  IF v_throttle.sent_count >= COALESCE(v_throttle.daily_limit, 50) THEN
    UPDATE message_jobs
    SET status = 'pending',
        reserved_at = NULL,
        scheduled_at = (v_today + INTERVAL '1 day'),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, 'Daily throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);
  IF v_hourly_count >= COALESCE(v_throttle.hourly_limit, 10) THEN
    UPDATE message_jobs
    SET status = 'pending',
        reserved_at = NULL,
        scheduled_at = date_trunc('hour', NOW()) + INTERVAL '1 hour',
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, 'Hourly throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  IF v_throttle.last_sent_at IS NOT NULL THEN
    v_time_since_last_send := NOW() - v_throttle.last_sent_at;
    IF v_time_since_last_send < INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180) THEN
      UPDATE message_jobs
      SET status = 'pending',
          reserved_at = NULL,
          scheduled_at = v_throttle.last_sent_at + INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = p_message_job_id;
      RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
      RETURN;
    END IF;
  END IF;

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
