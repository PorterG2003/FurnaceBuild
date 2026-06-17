-- Reply-lane sends (manual inbox + campaign_reply) should never wait for the
-- daily mailbox cap, but they still count against daily usage once sent.

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
  v_parent_status_reason TEXT;
  v_manual_inbox BOOLEAN;
  v_skip_daily_throttle BOOLEAN;
  v_retry_not_before TIMESTAMPTZ;
  v_inflight_count INTEGER;
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
    mj.throttle_bypass_next_attempt,
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

  v_skip_daily_throttle :=
    v_message_job.message_type = 'inbox_reply'
    OR v_message_job.message_type = 'inbox_forward'
    OR v_message_job.message_type = 'campaign_reply';

  IF v_message_job.mailbox_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Mailbox deleted';
    v_parent_status_reason := 'mailbox_deleted';
  ELSIF NOT v_manual_inbox THEN
    IF v_message_job.campaign_id IS NOT NULL AND v_message_job.campaign_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Campaign deleted';
      v_parent_status_reason := 'campaign_deleted';
    ELSIF v_message_job.lead_id IS NOT NULL AND v_message_job.lead_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Lead deleted';
      v_parent_status_reason := 'lead_deleted';
    ELSIF v_message_job.enrollment_id IS NOT NULL AND v_message_job.enrollment_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Enrollment deleted';
      v_parent_status_reason := 'enrollment_deleted';
    ELSIF v_message_job.node_id IS NOT NULL AND v_message_job.node_deleted_at IS NOT NULL THEN
      v_parent_failure_reason := 'Node deleted';
      v_parent_status_reason := 'node_deleted';
    END IF;
  END IF;

  IF v_parent_failure_reason IS NOT NULL THEN
    UPDATE message_jobs
    SET status = 'cancelled',
        status_reason = v_parent_status_reason,
        reserved_at = NULL,
        lease_expires_at = NULL,
        claim_token = NULL,
        error_message = v_parent_failure_reason,
        send_wait_reason = NULL,
        throttle_bypass_next_attempt = FALSE,
        updated_at = NOW()
    WHERE id = p_message_job_id;

    IF NOT v_manual_inbox AND v_message_job.enrollment_id IS NOT NULL THEN
      UPDATE enrollments
      SET
        state = 'stopped',
        next_run_at = NULL,
        stopped_reason = 'error',
        stopped_at = COALESCE(stopped_at, NOW()),
        stopped_error_message = v_parent_failure_reason,
        updated_at = NOW()
      WHERE id = v_message_job.enrollment_id
        AND deleted_at IS NULL
        AND state IN ('active', 'paused');
    END IF;

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

  SELECT COUNT(*)::INTEGER
  INTO v_inflight_count
  FROM message_jobs mj
  WHERE mj.mailbox_id = v_mailbox_id
    AND mj.id <> p_message_job_id
    AND mj.status IN ('reserved', 'sending')
    AND (
      mj.status = 'sending'
      OR mj.lease_expires_at IS NULL
      OR mj.lease_expires_at > NOW()
    );

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);

  IF v_message_job.throttle_bypass_next_attempt THEN
    UPDATE message_jobs
    SET send_wait_reason = NULL,
        throttle_bypass_next_attempt = FALSE,
        updated_at = NOW()
    WHERE id = p_message_job_id;

    RETURN QUERY SELECT true, NULL::TEXT;
    RETURN;
  END IF;

  IF NOT v_skip_daily_throttle
     AND (v_throttle.sent_count + v_inflight_count) >= COALESCE(v_throttle.daily_limit, 50) THEN
    v_retry_not_before := (v_today + INTERVAL '1 day');

    IF v_manual_inbox THEN
      UPDATE message_jobs
      SET status = 'queued',
          status_reason = NULL,
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          scheduled_at = v_retry_not_before,
          error_message = NULL,
          send_wait_reason = 'Daily send limit reached for this mailbox',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;
    ELSE
      UPDATE message_jobs
      SET status = 'deferred',
          status_reason = 'daily_throttle_limit',
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          error_message = NULL,
          send_wait_reason = 'Daily send limit reached for this mailbox',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;

      UPDATE enrollments
      SET next_run_at = GREATEST(v_retry_not_before, NOW()),
          updated_at = NOW()
      WHERE id = v_message_job.enrollment_id
        AND deleted_at IS NULL
        AND state = 'active';
    END IF;

    RETURN QUERY SELECT false, 'Daily throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  IF (v_hourly_count + v_inflight_count) >= COALESCE(v_throttle.hourly_limit, 10) THEN
    v_retry_not_before := date_trunc('hour', NOW()) + INTERVAL '1 hour';

    IF v_manual_inbox THEN
      UPDATE message_jobs
      SET status = 'queued',
          status_reason = NULL,
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          scheduled_at = v_retry_not_before,
          error_message = NULL,
          send_wait_reason = 'Hourly send limit reached for this mailbox',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;
    ELSE
      UPDATE message_jobs
      SET status = 'deferred',
          status_reason = 'hourly_throttle_limit',
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          error_message = NULL,
          send_wait_reason = 'Hourly send limit reached for this mailbox',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;

      UPDATE enrollments
      SET next_run_at = GREATEST(v_retry_not_before, NOW()),
          updated_at = NOW()
      WHERE id = v_message_job.enrollment_id
        AND deleted_at IS NULL
        AND state = 'active';
    END IF;

    RETURN QUERY SELECT false, 'Hourly throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  IF v_inflight_count > 0 THEN
    v_retry_not_before := NOW() + INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180);

    IF v_manual_inbox THEN
      UPDATE message_jobs
      SET status = 'queued',
          status_reason = NULL,
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          scheduled_at = v_retry_not_before,
          error_message = NULL,
          send_wait_reason = 'Waiting for existing in-flight mailbox send to finish',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;
    ELSE
      UPDATE message_jobs
      SET status = 'deferred',
          status_reason = 'min_gap_not_met',
          reserved_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          error_message = NULL,
          send_wait_reason = 'Waiting for existing in-flight mailbox send to finish',
          throttle_bypass_next_attempt = FALSE,
          updated_at = NOW()
      WHERE id = p_message_job_id;

      UPDATE enrollments
      SET next_run_at = GREATEST(v_retry_not_before, NOW()),
          updated_at = NOW()
      WHERE id = v_message_job.enrollment_id
        AND deleted_at IS NULL
        AND state = 'active';
    END IF;

    RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
    RETURN;
  END IF;

  IF v_throttle.last_sent_at IS NOT NULL THEN
    v_time_since_last_send := NOW() - v_throttle.last_sent_at;
    IF v_time_since_last_send < INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180) THEN
      v_retry_not_before := v_throttle.last_sent_at + INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180);

      IF v_manual_inbox THEN
        UPDATE message_jobs
        SET status = 'queued',
            status_reason = NULL,
            reserved_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            scheduled_at = v_retry_not_before,
            error_message = NULL,
            send_wait_reason = 'Waiting for minimum time between sends',
            throttle_bypass_next_attempt = FALSE,
            updated_at = NOW()
        WHERE id = p_message_job_id;
      ELSE
        UPDATE message_jobs
        SET status = 'deferred',
            status_reason = 'min_gap_not_met',
            reserved_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            error_message = NULL,
            send_wait_reason = 'Waiting for minimum time between sends',
            throttle_bypass_next_attempt = FALSE,
            updated_at = NOW()
        WHERE id = p_message_job_id;

        UPDATE enrollments
        SET next_run_at = GREATEST(v_retry_not_before, NOW()),
            updated_at = NOW()
        WHERE id = v_message_job.enrollment_id
          AND deleted_at IS NULL
          AND state = 'active';
      END IF;

      RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
      RETURN;
    END IF;
  END IF;

  UPDATE message_jobs
  SET send_wait_reason = NULL,
      updated_at = NOW()
  WHERE id = p_message_job_id;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_mailbox_throttle_and_reserve(UUID) IS
  'Atomically checks mailbox throttle limits for a reserved message job. Reply-lane sends (inbox_reply, inbox_forward, campaign_reply) skip daily waiting but still honor hourly and minimum-gap checks.';

CREATE OR REPLACE FUNCTION request_immediate_manual_send(
  p_message_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_job RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT
    mj.id,
    mj.account_id,
    mj.status,
    mj.message_type
  INTO v_job
  FROM message_jobs mj
  WHERE mj.id = p_message_job_id
  FOR UPDATE OF mj;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message job not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM account_users au
    WHERE au.account_id = v_job.account_id
      AND au.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_job.message_type NOT IN ('inbox_reply', 'inbox_forward') THEN
    RAISE EXCEPTION 'Only manual inbox jobs can be sent immediately';
  END IF;

  IF v_job.status <> 'queued' THEN
    RAISE EXCEPTION 'Only queued jobs can be sent immediately';
  END IF;

  UPDATE message_jobs
  SET scheduled_at = NOW(),
      send_wait_reason = NULL,
      throttle_bypass_next_attempt = TRUE,
      updated_at = NOW()
  WHERE id = p_message_job_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION request_immediate_manual_send(UUID) IS
  'Allows an authenticated account member to trigger a one-shot immediate send override for a queued manual inbox job.';

REVOKE ALL ON FUNCTION public.request_immediate_manual_send(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_immediate_manual_send(UUID) TO authenticated;
