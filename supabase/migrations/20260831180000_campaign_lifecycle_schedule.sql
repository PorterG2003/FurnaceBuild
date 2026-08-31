-- Campaign lifecycle dates: optional start/pause calendar dates, scheduled status,
-- indexed UTC instants, due-transition RPC, send-eligibility claim gates.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS pause_date DATE,
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_at TIMESTAMPTZ;

UPDATE public.campaigns
SET schedule_timezone = COALESCE(NULLIF(schedule->>'timezone', ''), 'America/Chicago')
WHERE schedule IS NOT NULL
  AND COALESCE(NULLIF(schedule->>'timezone', ''), '') <> '';

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'stopped'));

COMMENT ON COLUMN public.campaigns.schedule_timezone IS
  'IANA timezone used for calendar start/pause dates and 24/7 campaigns. Always persisted.';
COMMENT ON COLUMN public.campaigns.start_date IS
  'Optional first local sending date. Null means start as soon as the campaign is launched.';
COMMENT ON COLUMN public.campaigns.pause_date IS
  'Optional exclusive local pause date. Null means never auto-pause.';
COMMENT ON COLUMN public.campaigns.start_at IS
  'UTC instant of local midnight on start_date. Materialized for indexed due scans.';
COMMENT ON COLUMN public.campaigns.pause_at IS
  'UTC instant of local midnight on pause_date. Exclusive send cutoff.';

CREATE INDEX IF NOT EXISTS campaigns_scheduled_start_due_idx
  ON public.campaigns (start_at ASC, id)
  WHERE status = 'scheduled'
    AND deleted_at IS NULL
    AND start_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaigns_running_pause_due_idx
  ON public.campaigns (pause_at ASC, id)
  WHERE status = 'running'
    AND deleted_at IS NULL
    AND pause_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.campaign_is_send_eligible(
  p_status TEXT,
  p_deleted_at TIMESTAMPTZ,
  p_start_at TIMESTAMPTZ,
  p_pause_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_deleted_at IS NULL
    AND p_status = 'running'
    AND (p_start_at IS NULL OR p_start_at <= p_now)
    AND (p_pause_at IS NULL OR p_now < p_pause_at);
$$;

CREATE OR REPLACE FUNCTION public.campaigns_sync_lifecycle_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_schedule_tz TEXT;
BEGIN
  v_schedule_tz := NULLIF(NEW.schedule->>'timezone', '');

  IF NEW.schedule_timezone IS NULL OR btrim(NEW.schedule_timezone) = '' THEN
    NEW.schedule_timezone := COALESCE(v_schedule_tz, 'America/Chicago');
  END IF;

  IF v_schedule_tz IS NOT NULL AND v_schedule_tz IS DISTINCT FROM NEW.schedule_timezone THEN
    RAISE EXCEPTION 'schedule.timezone (%) conflicts with schedule_timezone (%)',
      v_schedule_tz, NEW.schedule_timezone
      USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    PERFORM timezone(NEW.schedule_timezone, NOW());
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.schedule_timezone
        USING ERRCODE = 'invalid_parameter_value';
  END;

  IF NEW.start_date IS NOT NULL THEN
    NEW.start_at := NEW.start_date::timestamp AT TIME ZONE NEW.schedule_timezone;
  ELSE
    NEW.start_at := NULL;
  END IF;

  IF NEW.pause_date IS NOT NULL THEN
    NEW.pause_at := NEW.pause_date::timestamp AT TIME ZONE NEW.schedule_timezone;
  ELSE
    NEW.pause_at := NULL;
  END IF;

  IF NEW.start_date IS NOT NULL AND NEW.pause_date IS NOT NULL AND NEW.pause_date <= NEW.start_date THEN
    RAISE EXCEPTION 'pause_date must be after start_date'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_sync_lifecycle_schedule ON public.campaigns;
CREATE TRIGGER trg_campaigns_sync_lifecycle_schedule
  BEFORE INSERT OR UPDATE OF schedule, schedule_timezone, start_date, pause_date
  ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.campaigns_sync_lifecycle_schedule();

CREATE OR REPLACE FUNCTION public.campaigns_guard_elapsed_pause_on_resume()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'running'
     AND OLD.status = 'paused'
     AND NEW.pause_at IS NOT NULL
     AND NEW.pause_at <= NOW() THEN
    RAISE EXCEPTION 'pause_at has elapsed; clear or move pause_date before resume'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_guard_elapsed_pause_on_resume ON public.campaigns;
CREATE TRIGGER trg_campaigns_guard_elapsed_pause_on_resume
  BEFORE UPDATE OF status ON public.campaigns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.campaigns_guard_elapsed_pause_on_resume();

CREATE OR REPLACE FUNCTION public.pause_campaign_core(p_campaign_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_deferred_jobs_count INTEGER := 0;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE campaigns
  SET status = 'paused',
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
    AND status IS DISTINCT FROM 'stopped'
    AND status IS DISTINCT FROM 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN 0;
  END IF;

  WITH deferred_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'deferred',
      status_reason = 'campaign_paused',
      reserved_at = NULL,
      send_wait_reason = NULL,
      updated_at = NOW()
    WHERE mj.campaign_id = p_campaign_id
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.status IN ('queued', 'reserved')
    RETURNING mj.enrollment_id
  ),
  cleared AS (
    UPDATE enrollments e
    SET next_run_at = NULL,
        updated_at = NOW()
    FROM (SELECT DISTINCT enrollment_id FROM deferred_jobs WHERE enrollment_id IS NOT NULL) ae
    WHERE e.id = ae.enrollment_id
      AND e.deleted_at IS NULL
      AND e.state = 'active'
    RETURNING e.id
  )
  SELECT COUNT(*)::INTEGER INTO v_deferred_jobs_count FROM deferred_jobs;

  RETURN COALESCE(v_deferred_jobs_count, 0);
END;
$$;

COMMENT ON FUNCTION public.pause_campaign_core(UUID) IS
  'Internal pause: set status paused, defer queued/reserved campaign jobs, clear affected enrollment next_run_at.';

REVOKE ALL ON FUNCTION public.pause_campaign_core(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_campaign_core(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.pause_campaign_and_defer_jobs(
  p_campaign_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  RETURN public.pause_campaign_core(p_campaign_id);
END;
$$;

COMMENT ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) IS
  'Pauses a campaign by deferring queued/reserved campaign attempts with status_reason campaign_paused and clearing enrollment next_run_at until resume.';

GRANT EXECUTE ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.process_due_campaign_schedule_transitions(
  p_batch_size INTEGER DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_processed INTEGER := 0;
  v_batch INTEGER;
  rec RECORD;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 50;
  END IF;
  IF p_batch_size > 500 THEN
    p_batch_size := 500;
  END IF;

  v_batch := p_batch_size;
  FOR rec IN
    SELECT c.id
    FROM public.campaigns c
    WHERE c.status = 'scheduled'
      AND c.deleted_at IS NULL
      AND c.start_at IS NOT NULL
      AND c.start_at <= v_now
    ORDER BY c.start_at ASC, c.id ASC
    LIMIT v_batch
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    UPDATE public.campaigns
    SET status = 'running',
        updated_at = v_now
    WHERE id = rec.id
      AND status = 'scheduled'
      AND deleted_at IS NULL;
    IF FOUND THEN
      v_processed := v_processed + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT c.id
    FROM public.campaigns c
    WHERE c.status = 'running'
      AND c.deleted_at IS NULL
      AND c.pause_at IS NOT NULL
      AND c.pause_at <= v_now
    ORDER BY c.pause_at ASC, c.id ASC
    LIMIT v_batch
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    IF public.pause_campaign_core(rec.id) >= 0 THEN
      v_processed := v_processed + 1;
    END IF;
  END LOOP;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION public.process_due_campaign_schedule_transitions(INTEGER) IS
  'Activate due scheduled campaigns and auto-pause running campaigns at pause_at. Scheduler-worker only.';

REVOKE ALL ON FUNCTION public.process_due_campaign_schedule_transitions(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_campaign_schedule_transitions(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.try_mark_campaign_message_job_sending(
  p_message_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_message_job_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    mj.id,
    mj.status,
    mj.message_type,
    mj.campaign_id,
    c.status AS campaign_status,
    c.deleted_at AS campaign_deleted_at,
    c.start_at,
    c.pause_at
  INTO v_job
  FROM message_jobs mj
  LEFT JOIN campaigns c ON c.id = mj.campaign_id
  WHERE mj.id = p_message_job_id
  FOR UPDATE OF mj;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_job.status IS DISTINCT FROM 'reserved' THEN
    RETURN FALSE;
  END IF;

  IF v_job.message_type IN ('inbox_reply', 'inbox_forward') THEN
    UPDATE message_jobs
    SET status = 'sending',
        status_reason = NULL,
        sending_started_at = v_now,
        updated_at = v_now
    WHERE id = p_message_job_id
      AND status = 'reserved';
    RETURN FOUND;
  END IF;

  IF NOT public.campaign_is_send_eligible(
    v_job.campaign_status,
    v_job.campaign_deleted_at,
    v_job.start_at,
    v_job.pause_at,
    v_now
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE message_jobs
  SET status = 'sending',
      status_reason = NULL,
      sending_started_at = v_now,
      updated_at = v_now
  WHERE id = p_message_job_id
    AND status = 'reserved';

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.try_mark_campaign_message_job_sending(UUID) IS
  'Atomically mark a reserved job sending only when the campaign is send-eligible. Inbox jobs skip campaign date gates.';

REVOKE ALL ON FUNCTION public.try_mark_campaign_message_job_sending(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_mark_campaign_message_job_sending(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.explain_due_campaign_schedule_starts()
RETURNS TABLE (plan TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  EXECUTE $q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT c.id
    FROM campaigns c
    WHERE c.status = 'scheduled'
      AND c.deleted_at IS NULL
      AND c.start_at IS NOT NULL
      AND c.start_at <= NOW()
    ORDER BY c.start_at ASC, c.id ASC
    LIMIT 50
  $q$;
END;
$$;

CREATE OR REPLACE FUNCTION public.explain_due_campaign_schedule_pauses()
RETURNS TABLE (plan TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  EXECUTE $q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT c.id
    FROM campaigns c
    WHERE c.status = 'running'
      AND c.deleted_at IS NULL
      AND c.pause_at IS NOT NULL
      AND c.pause_at <= NOW()
    ORDER BY c.pause_at ASC, c.id ASC
    LIMIT 50
  $q$;
END;
$$;

REVOKE ALL ON FUNCTION public.explain_due_campaign_schedule_starts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.explain_due_campaign_schedule_starts() TO service_role;
REVOKE ALL ON FUNCTION public.explain_due_campaign_schedule_pauses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.explain_due_campaign_schedule_pauses() TO service_role;

CREATE OR REPLACE FUNCTION claim_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  lead_id UUID,
  current_node_id UUID,
  state TEXT,
  next_run_at TIMESTAMPTZ,
  flow_position JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  WITH candidate_enrollments AS (
    SELECT e.id, e.next_run_at
    FROM enrollments e
    INNER JOIN campaigns c
      ON c.id = e.campaign_id
     AND public.campaign_is_send_eligible(c.status, c.deleted_at, c.start_at, c.pause_at, v_now)
    INNER JOIN leads l
      ON l.id = e.lead_id
     AND l.deleted_at IS NULL
    LEFT JOIN nodes n
      ON n.id = e.current_node_id
     AND n.deleted_at IS NULL
    WHERE e.state = 'active'
      AND e.deleted_at IS NULL
      AND e.next_run_at <= v_now
      AND (e.current_node_id IS NULL OR n.id IS NOT NULL)
    ORDER BY e.next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF e SKIP LOCKED
  ),
  updated_enrollments AS (
    UPDATE enrollments e
    SET
      next_run_at = v_now + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
      updated_at = v_now
    FROM candidate_enrollments ce
    WHERE e.id = ce.id
    RETURNING
      e.id,
      e.campaign_id,
      e.lead_id,
      e.current_node_id,
      e.state,
      e.next_run_at,
      e.flow_position,
      e.created_at,
      e.updated_at
  )
  SELECT
    updated_enrollments.id,
    updated_enrollments.campaign_id,
    updated_enrollments.lead_id,
    updated_enrollments.current_node_id,
    updated_enrollments.state,
    updated_enrollments.next_run_at,
    updated_enrollments.flow_position,
    updated_enrollments.created_at,
    updated_enrollments.updated_at
  FROM updated_enrollments
  ORDER BY updated_enrollments.next_run_at ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION claim_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 100,
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
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.scheduled_at
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND public.campaign_is_send_eligible(c.status, c.deleted_at, c.start_at, c.pause_at, v_now)
    INNER JOIN mailboxes m
      ON m.id = mj.mailbox_id
     AND m.deleted_at IS NULL
    INNER JOIN leads l
      ON l.id = mj.lead_id
     AND l.deleted_at IS NULL
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.deleted_at IS NULL
    LEFT JOIN nodes n
      ON n.id = mj.node_id
     AND n.deleted_at IS NULL
    WHERE mj.status = 'queued'
      AND mj.scheduled_at <= v_now
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND (mj.node_id IS NULL OR n.id IS NOT NULL)
    ORDER BY mj.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'reserved',
      status_reason = NULL,
      reserved_at = v_now,
      lease_expires_at = v_now + make_interval(mins => p_processing_timeout_minutes),
      claim_token = gen_random_uuid()::TEXT,
      sending_started_at = NULL,
      updated_at = v_now
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

CREATE OR REPLACE FUNCTION public.reclaim_stale_campaign_message_jobs(
  p_batch_size INTEGER DEFAULT 50,
  p_rearm_delay_seconds INTEGER DEFAULT 60,
  p_reserved_stale_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  message_job_id UUID,
  enrollment_id UUID,
  campaign_id UUID
) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.enrollment_id, mj.campaign_id
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND public.campaign_is_send_eligible(c.status, c.deleted_at, c.start_at, c.pause_at, v_now)
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.state = 'active'
     AND e.deleted_at IS NULL
    INNER JOIN leads l
      ON l.id = mj.lead_id
     AND l.deleted_at IS NULL
    INNER JOIN mailboxes m
      ON m.id = mj.mailbox_id
     AND m.deleted_at IS NULL
    LEFT JOIN nodes n
      ON n.id = mj.node_id
    WHERE mj.status = 'reserved'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND (
        (mj.lease_expires_at IS NOT NULL AND mj.lease_expires_at < v_now)
        OR (
          mj.lease_expires_at IS NULL
          AND mj.reserved_at IS NOT NULL
          AND mj.reserved_at < v_now - make_interval(mins => p_reserved_stale_minutes)
        )
      )
      AND (mj.node_id IS NULL OR (n.id IS NOT NULL AND n.deleted_at IS NULL))
      AND NOT EXISTS (
        SELECT 1
        FROM message_jobs newer
        WHERE newer.enrollment_id = mj.enrollment_id
          AND newer.node_id IS NOT DISTINCT FROM mj.node_id
          AND (newer.message_type = 'campaign' OR newer.message_type IS NULL)
          AND newer.created_at > mj.created_at
      )
    ORDER BY COALESCE(mj.lease_expires_at, mj.reserved_at) ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'deferred',
      status_reason = 'transient_read_error',
      reserved_at = NULL,
      lease_expires_at = NULL,
      claim_token = NULL,
      error_message = COALESCE(
        NULLIF(mj.error_message, ''),
        'Reserved lease expired before send completed'
      ),
      send_wait_reason = NULL,
      updated_at = v_now
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING mj.id, mj.enrollment_id, mj.campaign_id
  ),
  rearmed_enrollments AS (
    UPDATE enrollments e
    SET
      next_run_at = v_now + make_interval(secs => p_rearm_delay_seconds),
      updated_at = v_now
    FROM updated_jobs uj
    WHERE e.id = uj.enrollment_id
      AND e.state = 'active'
      AND e.deleted_at IS NULL
    RETURNING e.id
  )
  SELECT
    uj.id AS message_job_id,
    uj.enrollment_id,
    uj.campaign_id
  FROM updated_jobs uj;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_ready_interval_enrollments(
  p_campaign_id UUID,
  p_node_ids UUID[] DEFAULT '{}'::UUID[],
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  current_node_id UUID,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  lead_mailbox_id UUID,
  lead_email TEXT,
  lead_name TEXT,
  lead_first_name TEXT,
  lead_last_name TEXT
) AS $$
  SELECT
    e.id,
    e.lead_id,
    e.current_node_id,
    e.next_run_at,
    e.created_at,
    l.mailbox_id AS lead_mailbox_id,
    l.email AS lead_email,
    l.name AS lead_name,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM enrollments e
  INNER JOIN campaigns c
    ON c.id = e.campaign_id
   AND public.campaign_is_send_eligible(c.status, c.deleted_at, c.start_at, c.pause_at, p_now)
  INNER JOIN leads l
    ON l.id = e.lead_id
   AND l.deleted_at IS NULL
  WHERE e.campaign_id = p_campaign_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
    AND e.next_run_at IS NOT NULL
    AND e.next_run_at <= p_now
    AND e.current_node_id = ANY (COALESCE(p_node_ids, '{}'::UUID[]))
    AND NOT EXISTS (
      SELECT 1
      FROM message_jobs mj
      WHERE mj.enrollment_id = e.id
        AND mj.node_id = e.current_node_id
        AND mj.status IN (
          'pending',
          'reserved',
          'sending',
          'sent',
          'failed',
          'cancelled',
          'blocked'
        )
    )
  ORDER BY e.next_run_at ASC, e.created_at ASC, e.id ASC;
$$ LANGUAGE sql STABLE;
