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

  IF v_job.message_type NOT IN ('inbox_reply', 'inbox_forward', 'campaign_reply') THEN
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
  'Allows an authenticated account member to trigger a one-shot immediate send override for a queued reply-lane job (manual inbox reply/forward or campaign_reply).';

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

  IF v_job.message_type NOT IN ('inbox_reply', 'inbox_forward', 'campaign_reply') THEN
    RAISE EXCEPTION 'Only reply-lane jobs can be cancelled from the inbox';
  END IF;

  IF v_job.status NOT IN ('queued', 'reserved', 'failed') THEN
    RAISE EXCEPTION 'Only queued, reserved, or failed jobs can be cancelled';
  END IF;

  UPDATE message_jobs
  SET status = 'cancelled',
      status_reason = CASE
        WHEN v_job.message_type = 'campaign_reply' THEN 'inbox_manual_override'
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

  IF v_job.message_type = 'campaign_reply' AND v_job.enrollment_id IS NOT NULL THEN
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
  'Cancels a queued, reserved, or failed reply-lane job from the inbox. Manual inbox jobs become inbox_user_cancelled; campaign_reply jobs become inbox_manual_override and wake their enrollment for flow advancement.';

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
     AND COALESCE(v_current_node.node_data->>'send_mode', '') = 'reply' THEN
    SELECT EXISTS (
      SELECT 1
      FROM message_jobs mj
      WHERE mj.enrollment_id = v_enrollment.id
        AND mj.node_id = v_current_node.id
        AND mj.message_type = 'campaign_reply'
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
  'Returns whether a replied thread is in the pre-job categorizer/auto-reply pipeline before a campaign_reply pending bubble exists.';

REVOKE ALL ON FUNCTION public.get_thread_auto_reply_pipeline_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_thread_auto_reply_pipeline_state(UUID) TO authenticated;
