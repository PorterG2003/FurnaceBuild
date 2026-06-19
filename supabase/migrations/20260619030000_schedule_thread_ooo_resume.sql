-- Unified OOO resume facade: one authenticated entry point that preserves
-- visible thread OOO/Auto Reply state while resuming campaign execution from
-- either the legacy stopped/replied path or the categorizer held path.

CREATE OR REPLACE FUNCTION public.schedule_thread_ooo_resume(
  p_thread_id uuid,
  p_resume_at timestamptz DEFAULT NULL,
  p_return_date text DEFAULT NULL,
  p_mark_auto_reply boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread record;
  v_enrollment record;
  v_previous_positive boolean := false;
  v_result text := 'no_resumable_execution_state';
  v_handling_metadata jsonb := '{}'::jsonb;
  v_restore_ok boolean := false;
BEGIN
  IF p_thread_id IS NULL THEN
    RAISE EXCEPTION 'thread_id required';
  END IF;

  SELECT
    t.id,
    t.account_id,
    t.enrollment_id,
    t.campaign_id,
    t.message_job_id,
    t.category,
    t.category_source,
    t.handling_metadata
  INTO v_thread
  FROM public.email_threads t
  WHERE t.id = p_thread_id
  FOR UPDATE;

  IF v_thread.id IS NULL THEN
    RAISE EXCEPTION 'Thread not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = v_thread.account_id
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  v_previous_positive := v_thread.category = 'Interested';
  v_handling_metadata := COALESCE(v_thread.handling_metadata::jsonb, '{}'::jsonb);

  IF p_mark_auto_reply THEN
    v_handling_metadata := jsonb_set(
      v_handling_metadata,
      '{category}',
      to_jsonb('Auto Reply'::text),
      true
    );
    v_handling_metadata := jsonb_set(
      v_handling_metadata,
      '{return_date}',
      to_jsonb(p_return_date::text),
      true
    );
  END IF;

  UPDATE public.email_threads
  SET
    out_of_office = true,
    category = CASE WHEN p_mark_auto_reply THEN 'Auto Reply' ELSE category END,
    category_source = CASE
      WHEN NOT p_mark_auto_reply THEN category_source
      WHEN category = 'Auto Reply' AND category_source IS NOT NULL THEN category_source
      ELSE 'user'
    END,
    handling_metadata = CASE
      WHEN p_mark_auto_reply THEN v_handling_metadata
      ELSE handling_metadata
    END,
    updated_at = NOW()
  WHERE id = p_thread_id;

  IF p_mark_auto_reply AND v_thread.campaign_id IS NOT NULL AND v_thread.message_job_id IS NOT NULL THEN
    PERFORM public.update_replied_event_is_positive(
      v_thread.campaign_id,
      v_thread.message_job_id,
      false
    );

    IF v_previous_positive THEN
      PERFORM public.update_campaign_stats_positive_reply(v_thread.campaign_id, -1);
    END IF;
  END IF;

  IF p_resume_at IS NULL THEN
    UPDATE public.email_threads
    SET
      ooo_resume_requested = false,
      ooo_resume_at = NULL,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;
    RETURN 'marked_only';
  END IF;

  IF v_thread.enrollment_id IS NULL THEN
    UPDATE public.email_threads
    SET
      ooo_resume_requested = false,
      ooo_resume_at = NULL,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;
    RETURN v_result;
  END IF;

  SELECT
    e.id,
    e.state,
    e.stopped_reason,
    e.held_node_id,
    e.deleted_at
  INTO v_enrollment
  FROM public.enrollments e
  WHERE e.id = v_thread.enrollment_id
  FOR UPDATE;

  IF v_enrollment.id IS NULL OR v_enrollment.deleted_at IS NOT NULL THEN
    UPDATE public.email_threads
    SET
      ooo_resume_requested = false,
      ooo_resume_at = NULL,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;
    RETURN v_result;
  END IF;

  IF v_enrollment.state = 'active' AND v_enrollment.held_node_id IS NOT NULL THEN
    SELECT public.restore_enrollment_outbound(v_thread.enrollment_id, p_resume_at) INTO v_restore_ok;

    IF v_restore_ok THEN
      UPDATE public.email_threads
      SET
        ooo_resume_requested = false,
        ooo_resume_at = p_resume_at,
        ooo_resume_processed_at = NOW(),
        updated_at = NOW()
      WHERE id = p_thread_id;
      RETURN 'resumed_held';
    END IF;
  END IF;

  IF v_enrollment.state = 'stopped' AND v_enrollment.stopped_reason = 'replied' THEN
    UPDATE public.email_threads
    SET
      ooo_resume_requested = true,
      ooo_resume_at = p_resume_at,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;

    IF p_resume_at <= NOW() THEN
      PERFORM public.apply_ooo_resume_core(v_thread.enrollment_id, NOW());

      UPDATE public.email_threads
      SET
        ooo_resume_requested = false,
        ooo_resume_processed_at = NOW(),
        updated_at = NOW()
      WHERE id = p_thread_id;

      RETURN 'resumed_stopped';
    END IF;

    RETURN 'scheduled_stopped';
  END IF;

  UPDATE public.email_threads
  SET
    ooo_resume_requested = false,
    ooo_resume_at = NULL,
    ooo_resume_processed_at = NULL,
    updated_at = NOW()
  WHERE id = p_thread_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.schedule_thread_ooo_resume(uuid, timestamptz, text, boolean) IS
  'Unified OOO resume facade: marks the thread OOO, optionally stamps Auto Reply state, and resumes from either held categorizer state or stopped/replied legacy state.';

GRANT EXECUTE ON FUNCTION public.schedule_thread_ooo_resume(uuid, timestamptz, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_thread_ooo_resume(uuid, timestamptz, text, boolean) TO service_role;
