-- Extend wake_enrollment_for_thread_category so user category corrections can
-- re-enter the categorizer after Neutral no-edge completion or hard-stop orphans.
-- Scheduler branchEnrollment remains the only edge follower.

CREATE OR REPLACE FUNCTION public.wake_enrollment_for_thread_category(
  p_thread_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_enrollment_id UUID;
  v_campaign_id UUID;
  v_category TEXT;
  v_categorizer_node_id UUID;
  v_enrollment RECORD;
  v_woken INT;
BEGIN
  IF p_thread_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT t.account_id, t.enrollment_id, t.campaign_id, t.category
  INTO v_account_id, v_enrollment_id, v_campaign_id, v_category
  FROM email_threads t
  WHERE t.id = p_thread_id;

  IF v_account_id IS NULL OR v_enrollment_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = v_account_id
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  -- 1) Existing behavior: wake parked active@categorizer.
  UPDATE enrollments e
  SET
    next_run_at = NOW(),
    updated_at = NOW()
  FROM nodes n
  WHERE e.id = v_enrollment_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
    AND e.next_run_at IS NULL
    AND n.id = e.current_node_id
    AND n.node_type = 'aiCategorizer';

  GET DIAGNOSTICS v_woken = ROW_COUNT;
  IF v_woken > 0 THEN
    RETURN TRUE;
  END IF;

  -- 2) User correction re-arm: only for branch categories on categorizer campaigns.
  IF v_category IS NULL OR v_category NOT IN ('Interested', 'Neutral', 'Not Interested') THEN
    RETURN FALSE;
  END IF;

  IF v_campaign_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT n.id
  INTO v_categorizer_node_id
  FROM nodes n
  WHERE n.campaign_id = v_campaign_id
    AND n.node_type = 'aiCategorizer'
    AND n.deleted_at IS NULL
  ORDER BY n.created_at ASC
  LIMIT 1;

  IF v_categorizer_node_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Idempotent: already sent a priority/branch reply for this enrollment.
  IF EXISTS (
    SELECT 1
    FROM message_jobs mj
    WHERE mj.enrollment_id = v_enrollment_id
      AND mj.status = 'sent'
      AND mj.message_type IN ('campaign_priority', 'campaign_reply')
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT e.id, e.state, e.stopped_reason, e.reply_thread_id, e.current_node_id, e.deleted_at
  INTO v_enrollment
  FROM enrollments e
  WHERE e.id = v_enrollment_id
  FOR UPDATE;

  IF NOT FOUND OR v_enrollment.deleted_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  -- Eligible shapes:
  --   completed @ categorizer (Neutral no-edge exit)
  --   stopped/replied (park-miss orphan or similar), any current node
  --   active @ categorizer with next_run_at already set is a no-op above
  IF NOT (
    (v_enrollment.state = 'completed' AND v_enrollment.current_node_id = v_categorizer_node_id)
    OR (v_enrollment.state = 'stopped' AND v_enrollment.stopped_reason = 'replied')
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE enrollments e
  SET
    state = 'active',
    stopped_reason = NULL,
    stopped_at = NULL,
    stopped_error_message = NULL,
    current_node_id = v_categorizer_node_id,
    reply_thread_id = p_thread_id,
    held_node_id = NULL,
    held_next_run_at = NULL,
    next_run_at = NOW(),
    updated_at = NOW()
  WHERE e.id = v_enrollment_id;

  GET DIAGNOSTICS v_woken = ROW_COUNT;
  RETURN v_woken > 0;
END;
$$;

COMMENT ON FUNCTION public.wake_enrollment_for_thread_category(UUID) IS
  'Wakes parked active@categorizer enrollments, or reactivates completed@categorizer / stopped-replied orphans onto the categorizer when the thread has a branch category and no campaign_priority/campaign_reply has been sent yet. Scheduler still owns edge following.';

GRANT EXECUTE ON FUNCTION public.wake_enrollment_for_thread_category(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wake_enrollment_for_thread_category(UUID) TO service_role;
