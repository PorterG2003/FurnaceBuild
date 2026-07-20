-- Priority reframe: rename campaign_reply -> campaign_priority with dual-accept
-- compatibility window so in-flight campaign_reply rows keep working.
-- Node signal: prefer node_data.priority = true; fall back to send_mode = reply.

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_message_type_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_message_type_check
  CHECK (message_type IN ('campaign', 'inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority'));

COMMENT ON COLUMN message_jobs.message_type IS
  'campaign = paced scheduler-created; inbox_reply | inbox_forward = user-initiated from inbox; campaign_priority = post-categorizer priority lane (interval_id NULL). campaign_reply is a legacy alias accepted during the compatibility window.';

DROP INDEX IF EXISTS idx_message_jobs_queued_manual;
CREATE INDEX IF NOT EXISTS idx_message_jobs_queued_manual
  ON message_jobs (scheduled_at)
  WHERE status = 'queued' AND message_type IN ('inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority');


CREATE OR REPLACE FUNCTION claim_manual_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 50,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  message_type TEXT,
  status TEXT,
  scheduled_at TIMESTAMPTZ,
  reserved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_message TEXT,
  retry_count INTEGER,
  max_retries INTEGER,
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.scheduled_at
    FROM message_jobs mj
    INNER JOIN mailboxes m
      ON m.id = mj.mailbox_id
     AND m.deleted_at IS NULL
    WHERE mj.status = 'queued'
      AND mj.scheduled_at <= NOW()
      AND mj.message_type IN ('inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority')
    ORDER BY mj.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'reserved',
      status_reason = NULL,
      reserved_at = NOW(),
      updated_at = NOW()
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING
      mj.id,
      mj.enrollment_id,
      mj.campaign_id,
      mj.lead_id,
      mj.mailbox_id,
      mj.node_id,
      mj.message_type,
      mj.status,
      mj.scheduled_at,
      mj.reserved_at,
      mj.sent_at,
      mj.provider_message_id,
      mj.error_message,
      mj.retry_count,
      mj.max_retries,
      mj.message_data,
      mj.created_at,
      mj.updated_at
  )
  SELECT
    updated_jobs.id,
    updated_jobs.enrollment_id,
    updated_jobs.campaign_id,
    updated_jobs.lead_id,
    updated_jobs.mailbox_id,
    updated_jobs.node_id,
    updated_jobs.message_type,
    updated_jobs.status,
    updated_jobs.scheduled_at,
    updated_jobs.reserved_at,
    updated_jobs.sent_at,
    updated_jobs.provider_message_id,
    updated_jobs.error_message,
    updated_jobs.retry_count,
    updated_jobs.max_retries,
    updated_jobs.message_data,
    updated_jobs.created_at,
    updated_jobs.updated_at
  FROM updated_jobs
  ORDER BY updated_jobs.scheduled_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_manual_message_jobs_ready IS
  'Claims priority-lane jobs (inbox_reply, inbox_forward, campaign_reply, campaign_priority) ready to send. Call before claim_message_jobs_ready.';


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
    OR v_message_job.message_type = 'campaign_reply'
    OR v_message_job.message_type = 'campaign_priority';

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
  'Atomically checks mailbox throttle limits for a reserved message job. Reply-lane sends (inbox_reply, inbox_forward, campaign_reply, campaign_priority) skip daily waiting but still honor hourly and minimum-gap checks.';

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

  IF v_job.message_type NOT IN ('inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority') THEN
    RAISE EXCEPTION 'Only reply-lane jobs can be sent immediately';
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
  'Allows an authenticated account member to trigger a one-shot immediate send override for a queued reply-lane job (manual inbox reply/forward or campaign_priority/campaign_reply).';

REVOKE ALL ON FUNCTION public.request_immediate_manual_send(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_immediate_manual_send(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_pending_outbound_job(
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
    mj.message_type,
    mj.enrollment_id
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

  IF v_job.message_type NOT IN ('inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority') THEN
    RAISE EXCEPTION 'Only reply-lane jobs can be cancelled from the inbox';
  END IF;

  IF v_job.status NOT IN ('queued', 'reserved', 'failed') THEN
    RAISE EXCEPTION 'Only queued, reserved, or failed jobs can be cancelled';
  END IF;

  UPDATE message_jobs
  SET status = 'cancelled',
      status_reason = CASE
        WHEN v_job.message_type IN ('campaign_reply', 'campaign_priority') THEN 'inbox_manual_override'
        ELSE 'inbox_user_cancelled'
      END,
      error_message = 'Cancelled from inbox',
      reserved_at = NULL,
      lease_expires_at = NULL,
      claim_token = NULL,
      sending_started_at = NULL,
      send_wait_reason = NULL,
      throttle_bypass_next_attempt = FALSE,
      updated_at = NOW()
  WHERE id = p_message_job_id;

  IF v_job.message_type IN ('campaign_reply', 'campaign_priority') AND v_job.enrollment_id IS NOT NULL THEN
    UPDATE enrollments
    SET next_run_at = NOW(),
        updated_at = NOW()
    WHERE id = v_job.enrollment_id
      AND state = 'active'
      AND deleted_at IS NULL;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION cancel_pending_outbound_job(UUID) IS
  'Cancels a queued, reserved, or failed reply-lane job from the inbox. Manual inbox jobs become inbox_user_cancelled; campaign_priority/campaign_reply jobs become inbox_manual_override and wake their enrollment for flow advancement.';

REVOKE ALL ON FUNCTION public.cancel_pending_outbound_job(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pending_outbound_job(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION get_thread_auto_reply_pipeline_state(
  p_thread_id UUID
)
RETURNS TABLE (
  active BOOLEAN,
  phase TEXT,
  label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_thread RECORD;
  v_enrollment RECORD;
  v_current_node RECORD;
  v_latest_thread_id UUID;
  v_use_ai BOOLEAN := FALSE;
  v_has_reply_job BOOLEAN := FALSE;
BEGIN
  IF p_thread_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    t.id,
    t.account_id,
    t.enrollment_id,
    t.has_reply,
    t.category
  INTO v_thread
  FROM email_threads t
  WHERE t.id = p_thread_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM account_users au
      WHERE au.user_id = v_user_id
        AND au.account_id = v_thread.account_id
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  IF v_thread.enrollment_id IS NULL OR v_thread.has_reply IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  SELECT
    e.id,
    e.campaign_id,
    e.current_node_id,
    e.reply_thread_id,
    e.next_run_at,
    e.state,
    e.deleted_at
  INTO v_enrollment
  FROM enrollments e
  WHERE e.id = v_thread.enrollment_id;

  IF NOT FOUND OR v_enrollment.state <> 'active' OR v_enrollment.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM nodes n
    WHERE n.campaign_id = v_enrollment.campaign_id
      AND n.node_type = 'aiCategorizer'
      AND n.deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT t.id
  INTO v_latest_thread_id
  FROM email_threads t
  WHERE t.enrollment_id = v_thread.enrollment_id
    AND t.has_reply IS TRUE
  ORDER BY t.last_message_at DESC, t.id DESC
  LIMIT 1;

  IF v_latest_thread_id IS DISTINCT FROM p_thread_id THEN
    RETURN;
  END IF;

  SELECT
    n.id,
    n.node_type,
    n.node_data
  INTO v_current_node
  FROM nodes n
  WHERE n.id = v_enrollment.current_node_id
    AND n.deleted_at IS NULL;

  IF v_current_node.id IS NULL THEN
    RETURN;
  END IF;

  IF v_current_node.node_type = 'aiCategorizer' AND v_enrollment.reply_thread_id IS NULL THEN
    IF v_thread.category = 'Auto Reply' THEN
      RETURN;
    END IF;

    v_use_ai := COALESCE((v_current_node.node_data->>'use_ai')::BOOLEAN, FALSE);

    RETURN QUERY
    SELECT
      TRUE,
      'categorizing'::TEXT,
      CASE
        WHEN v_thread.category IN ('Interested', 'Neutral', 'Not Interested')
          THEN 'Automated reply preparing...'
        WHEN v_use_ai AND v_enrollment.next_run_at IS NOT NULL
          THEN 'Classifying reply...'
        WHEN v_use_ai
          THEN 'Reply received - automated reply pending classification.'
        ELSE 'Awaiting categorization - an automated reply may send after you categorize.'
      END;
    RETURN;
  END IF;

  IF v_enrollment.reply_thread_id = p_thread_id
     AND v_current_node.node_type = 'email'
     AND (
       COALESCE(v_current_node.node_data->>'priority', '') = 'true'
       OR COALESCE(v_current_node.node_data->>'send_mode', '') = 'reply'
     ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM message_jobs mj
      WHERE mj.enrollment_id = v_enrollment.id
        AND mj.node_id = v_current_node.id
        AND mj.message_type IN ('campaign_reply', 'campaign_priority')
    )
    INTO v_has_reply_job;

    IF NOT v_has_reply_job THEN
      RETURN QUERY
      SELECT TRUE, 'arming_reply'::TEXT, 'Automated reply preparing...'::TEXT;
      RETURN;
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION get_thread_auto_reply_pipeline_state(UUID) IS
  'Returns whether a replied thread is in the pre-job categorizer/auto-reply pipeline before a campaign_priority pending bubble exists.';

REVOKE ALL ON FUNCTION public.get_thread_auto_reply_pipeline_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_thread_auto_reply_pipeline_state(UUID) TO authenticated;
