-- Out-of-office (OOO) flags on inbox threads + resume stopped enrollments (replied) at a scheduled time.

ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS out_of_office boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ooo_resume_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ooo_resume_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ooo_resume_processed_at timestamptz NULL;

COMMENT ON COLUMN public.email_threads.out_of_office IS 'User marked thread as out-of-office; can hide from default inbox list.';
COMMENT ON COLUMN public.email_threads.ooo_resume_requested IS 'When true, scheduler should reactivate enrollment after ooo_resume_at.';
COMMENT ON COLUMN public.email_threads.ooo_resume_at IS 'When to run OOO resume for this thread (if ooo_resume_requested).';
COMMENT ON COLUMN public.email_threads.ooo_resume_processed_at IS 'Set when OOO resume has been applied (idempotency).';

-- Partial index for process_due_out_of_office_resumes due query (range on ooo_resume_at).
CREATE INDEX IF NOT EXISTS email_threads_ooo_due_resume_idx
  ON public.email_threads (ooo_resume_at ASC, id)
  WHERE ooo_resume_requested = true
    AND out_of_office = true
    AND ooo_resume_processed_at IS NULL
    AND enrollment_id IS NOT NULL
    AND ooo_resume_at IS NOT NULL;

-- Core resume: reactivate enrollment stopped for reply; bump pending campaign jobs (not manual inbox).
CREATE OR REPLACE FUNCTION public.apply_ooo_resume_core(
  p_enrollment_id uuid,
  p_not_before timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor timestamptz := GREATEST(p_not_before, NOW());
BEGIN
  IF p_enrollment_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.enrollments e
  SET
    state = 'active',
    stopped_reason = NULL,
    stopped_at = NULL,
    stopped_error_message = NULL,
    next_run_at = v_floor,
    updated_at = NOW()
  WHERE e.id = p_enrollment_id
    AND e.state = 'stopped'
    AND e.stopped_reason = 'replied'
    AND e.deleted_at IS NULL;

  UPDATE public.message_jobs mj
  SET
    scheduled_at = GREATEST(mj.scheduled_at, v_floor + INTERVAL '30 seconds'),
    updated_at = NOW()
  WHERE mj.enrollment_id = p_enrollment_id
    AND mj.status IN ('pending', 'reserved')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward')
    AND (mj.message_type IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_type IS DISTINCT FROM 'inbox_forward');
END;
$$;

COMMENT ON FUNCTION public.apply_ooo_resume_core(uuid, timestamptz) IS
  'Internal: set enrollment active from stopped/replied and push pending campaign job times forward. Not granted to API clients.';

REVOKE ALL ON FUNCTION public.apply_ooo_resume_core(uuid, timestamptz) FROM PUBLIC;

-- Mark / schedule / clear OOO on a thread (authenticated users; service_role for ops).
CREATE OR REPLACE FUNCTION public.mark_email_thread_out_of_office(
  p_thread_id uuid,
  p_out_of_office boolean,
  p_resume_requested boolean,
  p_resume_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_enrollment_id uuid;
  v_enr_state text;
  v_enr_stopped_reason text;
BEGIN
  IF p_thread_id IS NULL THEN
    RAISE EXCEPTION 'thread_id required';
  END IF;

  SELECT t.account_id, t.enrollment_id
  INTO v_account_id, v_enrollment_id
  FROM public.email_threads t
  WHERE t.id = p_thread_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Thread not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = v_account_id
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  IF NOT p_out_of_office THEN
    UPDATE public.email_threads
    SET
      out_of_office = false,
      ooo_resume_requested = false,
      ooo_resume_at = NULL,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;
    RETURN;
  END IF;

  IF p_resume_requested AND p_resume_at IS NULL THEN
    RAISE EXCEPTION 'resume_at is required when resume is requested';
  END IF;

  IF NOT p_resume_requested THEN
    UPDATE public.email_threads
    SET
      out_of_office = true,
      ooo_resume_requested = false,
      ooo_resume_at = NULL,
      ooo_resume_processed_at = NULL,
      updated_at = NOW()
    WHERE id = p_thread_id;
    RETURN;
  END IF;

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Thread has no enrollment; cannot schedule resume';
  END IF;

  SELECT e.state, e.stopped_reason
  INTO v_enr_state, v_enr_stopped_reason
  FROM public.enrollments e
  WHERE e.id = v_enrollment_id
    AND e.deleted_at IS NULL;

  IF v_enr_state IS NULL OR NOT (v_enr_state = 'stopped' AND v_enr_stopped_reason = 'replied') THEN
    RAISE EXCEPTION 'Enrollment is not in a resumable state (need stopped + replied)';
  END IF;

  UPDATE public.email_threads
  SET
    out_of_office = true,
    ooo_resume_requested = true,
    ooo_resume_at = p_resume_at,
    ooo_resume_processed_at = NULL,
    updated_at = NOW()
  WHERE id = p_thread_id;

  IF p_resume_at <= NOW() THEN
    PERFORM public.apply_ooo_resume_core(v_enrollment_id, NOW());
    UPDATE public.email_threads
    SET
      ooo_resume_processed_at = NOW(),
      ooo_resume_requested = false,
      updated_at = NOW()
    WHERE id = p_thread_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.mark_email_thread_out_of_office(uuid, boolean, boolean, timestamptz) IS
  'Mark thread OOO; optionally schedule resume for stopped/replied enrollment. Immediate resume if p_resume_at <= now().';

GRANT EXECUTE ON FUNCTION public.mark_email_thread_out_of_office(uuid, boolean, boolean, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_email_thread_out_of_office(uuid, boolean, boolean, timestamptz) TO service_role;

-- Drain due OOO resumes (scheduler / service_role).
CREATE OR REPLACE FUNCTION public.process_due_out_of_office_resumes(p_batch_size integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed integer := 0;
  rec record;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 50;
  END IF;
  IF p_batch_size > 500 THEN
    p_batch_size := 500;
  END IF;

  FOR rec IN
    SELECT et.id AS thread_id, et.enrollment_id
    FROM public.email_threads et
    WHERE et.ooo_resume_requested = true
      AND et.out_of_office = true
      AND et.ooo_resume_processed_at IS NULL
      AND et.enrollment_id IS NOT NULL
      AND et.ooo_resume_at IS NOT NULL
      AND et.ooo_resume_at <= NOW()
    ORDER BY et.ooo_resume_at ASC, et.id ASC
    LIMIT p_batch_size
    FOR UPDATE OF et SKIP LOCKED
  LOOP
    PERFORM public.apply_ooo_resume_core(rec.enrollment_id, NOW());

    UPDATE public.email_threads
    SET
      ooo_resume_processed_at = NOW(),
      ooo_resume_requested = false,
      updated_at = NOW()
    WHERE id = rec.thread_id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION public.process_due_out_of_office_resumes(integer) IS
  'Apply due OOO resumes in batches. Intended for scheduler-worker (service_role). Returns number of threads processed.';

GRANT EXECUTE ON FUNCTION public.process_due_out_of_office_resumes(integer) TO service_role;
-- Authenticated not granted: avoids arbitrary clients draining resumes.
