ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS status_reason TEXT;

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_status_check;

UPDATE message_jobs
SET status = 'queued'
WHERE status = 'pending';

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_status_check
  CHECK (status IN ('queued', 'reserved', 'sending', 'sent', 'deferred', 'failed', 'cancelled', 'blocked'));

UPDATE message_jobs
SET status_reason = CASE
  WHEN status IN ('queued', 'reserved', 'sending') THEN NULL
  WHEN status = 'sent' THEN 'sent_successfully'
  WHEN status = 'failed' THEN CASE
    WHEN COALESCE(error_message, '') ILIKE '%template%'
      OR COALESCE(error_message, '') ILIKE '%render%'
      THEN 'template_render_error'
    ELSE 'provider_error'
  END
  WHEN status = 'cancelled' THEN CASE
    WHEN COALESCE(error_message, '') = 'Campaign deleted' THEN 'campaign_deleted'
    WHEN COALESCE(error_message, '') = 'Mailbox deleted' THEN 'mailbox_deleted'
    WHEN COALESCE(error_message, '') = 'Lead deleted' THEN 'lead_deleted'
    WHEN COALESCE(error_message, '') = 'Enrollment deleted' THEN 'enrollment_deleted'
    WHEN COALESCE(error_message, '') = 'Node deleted' THEN 'node_deleted'
    WHEN COALESCE(error_message, '') ILIKE 'Enrollment not active%' THEN 'enrollment_not_active'
    ELSE 'manually_cancelled'
  END
  WHEN status = 'blocked' THEN CASE
    WHEN COALESCE(error_message, '') ILIKE '%mailbox%' THEN 'mailbox_blocked'
    ELSE 'lead_blocked'
  END
  ELSE status_reason
END
WHERE status_reason IS NULL;

CREATE OR REPLACE FUNCTION public.message_job_status_reason_is_valid(
  p_status TEXT,
  p_status_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_status
    WHEN 'queued' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'reserved' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sending' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sent' THEN
      RETURN p_status_reason = 'sent_successfully';
    WHEN 'deferred' THEN
      RETURN p_status_reason IN (
        'daily_throttle_limit',
        'hourly_throttle_limit',
        'min_gap_not_met',
        'campaign_paused'
      );
    WHEN 'failed' THEN
      RETURN p_status_reason IN (
        'provider_error',
        'template_render_error'
      );
    WHEN 'cancelled' THEN
      RETURN p_status_reason IN (
        'campaign_deleted',
        'mailbox_deleted',
        'lead_deleted',
        'enrollment_deleted',
        'node_deleted',
        'enrollment_not_active',
        'manually_cancelled'
      );
    WHEN 'blocked' THEN
      RETURN p_status_reason IN (
        'lead_blocked',
        'mailbox_blocked'
      );
    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_status_reason_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_status_reason_check
  CHECK (public.message_job_status_reason_is_valid(status, status_reason));

COMMENT ON COLUMN message_jobs.status IS
  'queued|reserved|sending|sent|deferred|failed|cancelled|blocked. deferred = historical retryable attempt; blocked = policy/safety prevention.';

COMMENT ON COLUMN message_jobs.status_reason IS
  'Strict reason paired with status. queued/reserved/sending use NULL in v1.';

DROP INDEX IF EXISTS idx_message_jobs_status_scheduled_at;
CREATE INDEX IF NOT EXISTS idx_message_jobs_status_scheduled_at
  ON message_jobs(status, scheduled_at)
  WHERE status = 'queued';

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
  v_retry_not_before TIMESTAMPTZ;
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

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);

  IF v_message_job.throttle_bypass_next_attempt THEN
    UPDATE message_jobs
    SET send_wait_reason = NULL,
        throttle_bypass_next_attempt = FALSE,
        updated_at = NOW()
    WHERE id = p_message_job_id;

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
    RETURN;
  END IF;

  IF v_throttle.sent_count >= COALESCE(v_throttle.daily_limit, 50) THEN
    v_retry_not_before := (v_today + INTERVAL '1 day');

    IF v_manual_inbox THEN
      UPDATE message_jobs
      SET status = 'queued',
          status_reason = NULL,
          reserved_at = NULL,
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

  IF v_hourly_count >= COALESCE(v_throttle.hourly_limit, 10) THEN
    v_retry_not_before := date_trunc('hour', NOW()) + INTERVAL '1 hour';

    IF v_manual_inbox THEN
      UPDATE message_jobs
      SET status = 'queued',
          status_reason = NULL,
          reserved_at = NULL,
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

  IF v_throttle.last_sent_at IS NOT NULL THEN
    v_time_since_last_send := NOW() - v_throttle.last_sent_at;
    IF v_time_since_last_send < INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180) THEN
      v_retry_not_before := v_throttle.last_sent_at + INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180);

      IF v_manual_inbox THEN
        UPDATE message_jobs
        SET status = 'queued',
            status_reason = NULL,
            reserved_at = NULL,
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
      AND mj.message_type IN ('inbox_reply', 'inbox_forward')
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
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.scheduled_at
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.status = 'running'
     AND c.deleted_at IS NULL
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
      AND mj.scheduled_at <= NOW()
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

CREATE OR REPLACE FUNCTION public.get_existing_message_job_pairs(
  p_pairs JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE (
  enrollment_id UUID,
  node_id UUID
) AS $$
  WITH candidate_pairs AS (
    SELECT DISTINCT
      pair.enrollment_id,
      pair.node_id
    FROM jsonb_to_recordset(COALESCE(p_pairs, '[]'::JSONB)) AS pair(
      enrollment_id UUID,
      node_id UUID
    )
    WHERE pair.enrollment_id IS NOT NULL
      AND pair.node_id IS NOT NULL
  )
  SELECT DISTINCT
    candidate_pairs.enrollment_id,
    candidate_pairs.node_id
  FROM candidate_pairs
  INNER JOIN message_jobs
    ON message_jobs.enrollment_id = candidate_pairs.enrollment_id
   AND message_jobs.node_id = candidate_pairs.node_id
  WHERE message_jobs.status IN (
    'queued',
    'reserved',
    'sending',
    'sent',
    'failed',
    'cancelled',
    'blocked'
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.refresh_campaign_interval_progress_for_ids(
  p_interval_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
  v_interval_id UUID;
BEGIN
  IF p_interval_ids IS NULL OR array_length(p_interval_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH target_intervals AS (
    SELECT DISTINCT interval_id
    FROM unnest(p_interval_ids) AS t(interval_id)
    WHERE interval_id IS NOT NULL
  ),
  interval_job_counts AS (
    SELECT
      mj.interval_id,
      COUNT(*) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )::INTEGER AS expected_job_count,
      COUNT(DISTINCT mj.mailbox_id) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )::INTEGER AS assigned_mailbox_count,
      COUNT(*) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
          AND mj.status IN ('sent', 'deferred', 'failed', 'cancelled', 'blocked')
      )::INTEGER AS terminal_job_count
    FROM message_jobs mj
    INNER JOIN target_intervals ti
      ON ti.interval_id = mj.interval_id
    GROUP BY mj.interval_id
  )
  UPDATE campaign_intervals ci
  SET
    expected_job_count = COALESCE(ijc.expected_job_count, 0),
    assigned_mailbox_count = COALESCE(ijc.assigned_mailbox_count, 0),
    terminal_job_count = COALESCE(ijc.terminal_job_count, 0)
  FROM target_intervals ti
  LEFT JOIN interval_job_counts ijc
    ON ijc.interval_id = ti.interval_id
  WHERE ci.id = ti.interval_id;

  FOR v_interval_id IN
    SELECT DISTINCT interval_id
    FROM unnest(p_interval_ids) AS t(interval_id)
    WHERE interval_id IS NOT NULL
  LOOP
    PERFORM public.complete_campaign_interval_if_ready(v_interval_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION batch_assign_jobs_to_interval(
  p_campaign_id UUID,
  p_job_data JSONB[],
  p_worker_id TEXT DEFAULT 'scheduler',
  p_required_mailbox_count INTEGER DEFAULT NULL
)
RETURNS TABLE (
  jobs_created INTEGER,
  interval_id UUID,
  interval_time TIMESTAMPTZ
) AS $$
DECLARE
  v_account_id UUID;
  v_interval_id UUID;
  v_interval_time TIMESTAMPTZ;
  v_interval_duration_seconds INTEGER;
  v_flow_jobs_created INTEGER := 0;
BEGIN
  SELECT c.sending_interval_seconds, c.account_id
  INTO v_interval_duration_seconds, v_account_id
  FROM campaigns c
  WHERE c.id = p_campaign_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND OR v_account_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE campaign_intervals
  SET
    status = 'locked',
    locked_at = NOW(),
    locked_by = p_worker_id
  WHERE campaign_intervals.id = (
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.interval_time > NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_intervals ci_prev
        WHERE ci_prev.campaign_id = ci.campaign_id
          AND ci_prev.interval_time < ci.interval_time
          AND ci_prev.interval_time >= NOW()
          AND ci_prev.status != 'completed'
        ORDER BY ci_prev.interval_time DESC
        LIMIT 1
      )
      AND (ci.status = 'available' OR ci.status = 'scheduled')
    ORDER BY ci.interval_time ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING campaign_intervals.id, campaign_intervals.interval_time
  INTO v_interval_id, v_interval_time;

  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE campaign_intervals
  SET required_mailbox_count = COALESCE(p_required_mailbox_count, required_mailbox_count)
  WHERE id = v_interval_id;

  WITH input_jobs AS (
    SELECT DISTINCT
      (job_data->>'enrollment_id')::UUID AS enrollment_id,
      (job_data->>'lead_id')::UUID AS lead_id,
      (job_data->>'mailbox_id')::UUID AS mailbox_id,
      (job_data->>'node_id')::UUID AS node_id,
      job_data->'message_data' AS message_data,
      COALESCE((job_data->>'jitter_percentage')::NUMERIC, 10.0) AS jitter_percentage
    FROM unnest(COALESCE(p_job_data, ARRAY[]::JSONB[])) AS job_data
    WHERE job_data IS NOT NULL
  ),
  validated_jobs AS (
    SELECT
      ij.enrollment_id,
      ij.lead_id,
      ij.mailbox_id,
      ij.node_id,
      ij.message_data,
      e.current_flow_version_number AS flow_version_number,
      v_interval_time
        + (
          ((RANDOM() * 2 - 1) * (v_interval_duration_seconds * (ij.jitter_percentage / 100.0)))
          || ' seconds'
        )::INTERVAL AS scheduled_at
    FROM input_jobs ij
    INNER JOIN enrollments e
      ON e.id = ij.enrollment_id
     AND e.campaign_id = p_campaign_id
     AND e.lead_id = ij.lead_id
     AND e.current_node_id = ij.node_id
     AND e.state = 'active'
     AND e.deleted_at IS NULL
    INNER JOIN leads l
      ON l.id = ij.lead_id
     AND l.deleted_at IS NULL
    INNER JOIN mailboxes m
      ON m.id = ij.mailbox_id
     AND m.deleted_at IS NULL
    INNER JOIN nodes n
      ON n.id = ij.node_id
     AND n.deleted_at IS NULL
    WHERE NOT EXISTS (
      SELECT 1
      FROM message_jobs mj
      WHERE mj.interval_id = v_interval_id
        AND mj.mailbox_id = ij.mailbox_id
        AND mj.status IN ('queued', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
    )
      AND NOT EXISTS (
        SELECT 1
        FROM message_jobs mj
        WHERE mj.enrollment_id = ij.enrollment_id
          AND mj.node_id = ij.node_id
          AND mj.status IN ('queued', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
      )
  ),
  inserted_jobs AS (
    INSERT INTO message_jobs (
      enrollment_id,
      campaign_id,
      account_id,
      lead_id,
      mailbox_id,
      node_id,
      interval_id,
      scheduled_at,
      status,
      status_reason,
      message_data,
      flow_version_number
    )
    SELECT
      vj.enrollment_id,
      p_campaign_id,
      v_account_id,
      vj.lead_id,
      vj.mailbox_id,
      vj.node_id,
      v_interval_id,
      vj.scheduled_at,
      'queued',
      NULL,
      vj.message_data,
      vj.flow_version_number
    FROM validated_jobs vj
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER
  INTO v_flow_jobs_created
  FROM inserted_jobs;

  UPDATE campaign_intervals
  SET
    status = CASE
      WHEN v_flow_jobs_created > 0 OR expected_job_count > 0 THEN 'scheduled'
      ELSE 'available'
    END,
    locked_at = NULL,
    locked_by = NULL
  WHERE campaign_intervals.id = v_interval_id;

  PERFORM public.complete_campaign_interval_if_ready(v_interval_id);

  RETURN QUERY
  SELECT
    v_flow_jobs_created AS jobs_created,
    v_interval_id AS interval_id,
    v_interval_time AS interval_time;
END;
$$ LANGUAGE plpgsql;

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
    AND mj.status IN ('queued', 'reserved')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward')
    AND (mj.message_type IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_type IS DISTINCT FROM 'inbox_forward');
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_campaign_and_defer_jobs(
  p_campaign_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_deferred_jobs_count INTEGER := 0;
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

  UPDATE campaigns
  SET status = 'paused',
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL;

  UPDATE message_jobs mj
  SET
    status = 'deferred',
    status_reason = 'campaign_paused',
    reserved_at = NULL,
    send_wait_reason = NULL,
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND mj.status IN ('queued', 'reserved');

  GET DIAGNOSTICS v_deferred_jobs_count = ROW_COUNT;

  WITH affected_enrollments AS (
    SELECT DISTINCT mj.enrollment_id
    FROM message_jobs mj
    WHERE mj.campaign_id = p_campaign_id
      AND mj.status = 'deferred'
      AND mj.status_reason = 'campaign_paused'
      AND mj.enrollment_id IS NOT NULL
  )
  UPDATE enrollments e
  SET next_run_at = NULL,
      updated_at = NOW()
  FROM affected_enrollments ae
  WHERE e.id = ae.enrollment_id
    AND e.deleted_at IS NULL
    AND e.state = 'active';

  v_count := COALESCE(v_deferred_jobs_count, 0);
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) IS
  'Pauses a campaign by deferring queued/reserved campaign attempts with status_reason campaign_paused and clearing enrollment next_run_at until resume.';

GRANT EXECUTE ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_campaign_and_defer_jobs(UUID) TO service_role;

CREATE OR REPLACE FUNCTION resume_campaign_and_reschedule_jobs(
  p_campaign_id UUID,
  p_pause_reason TEXT DEFAULT 'Campaign paused'
)
RETURNS TABLE (
  revived_jobs INTEGER,
  rescheduled_jobs INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_anchor_interval_time TIMESTAMPTZ;
  v_jitter_percentage NUMERIC := 10.0;
  v_jitter_range_seconds NUMERIC := 0;
  v_min_scheduled_at TIMESTAMPTZ := NOW() + INTERVAL '30 seconds';
  v_rescheduled_jobs INTEGER := 0;
  v_pause_rearmed_enrollments INTEGER := 0;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN QUERY SELECT 0, 0;
      RETURN;
    END IF;
  END IF;

  SELECT
    c.id,
    c.account_id,
    c.sending_interval_seconds,
    c.deleted_at,
    COALESCE(c.jitter_percentage, a.jitter_percentage, 10.0) AS effective_jitter_percentage
  INTO v_campaign
  FROM campaigns c
  LEFT JOIN accounts a ON a.id = c.account_id
  WHERE c.id = p_campaign_id
  FOR UPDATE OF c;

  IF NOT FOUND OR v_campaign.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT ci.interval_time
  INTO v_anchor_interval_time
  FROM campaign_intervals ci
  WHERE ci.campaign_id = p_campaign_id
    AND ci.interval_time > NOW()
    AND ci.status IN ('available', 'scheduled')
  ORDER BY ci.interval_time ASC
  LIMIT 1;

  IF v_anchor_interval_time IS NULL THEN
    IF COALESCE(v_campaign.sending_interval_seconds, 0) > 0 THEN
      v_anchor_interval_time := NOW() + make_interval(secs => v_campaign.sending_interval_seconds);
    ELSE
      v_anchor_interval_time := NOW() + INTERVAL '5 minutes';
    END IF;
  END IF;

  v_jitter_percentage := COALESCE(v_campaign.effective_jitter_percentage, 10.0);
  v_jitter_range_seconds := GREATEST(
    COALESCE(v_campaign.sending_interval_seconds, 300) * (v_jitter_percentage / 100.0),
    0
  );

  UPDATE message_jobs mj
  SET
    reserved_at = NULL,
    scheduled_at = GREATEST(
      v_min_scheduled_at,
      v_anchor_interval_time + make_interval(
        secs => ((RANDOM() * 2 - 1) * v_jitter_range_seconds)::DOUBLE PRECISION
      )
    ),
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND mj.status = 'queued'
    AND mj.scheduled_at < NOW()
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward');

  GET DIAGNOSTICS v_rescheduled_jobs = ROW_COUNT;

  WITH pause_deferred_enrollments AS (
    SELECT DISTINCT mj.enrollment_id
    FROM message_jobs mj
    WHERE mj.campaign_id = p_campaign_id
      AND mj.status = 'deferred'
      AND mj.status_reason = 'campaign_paused'
      AND mj.enrollment_id IS NOT NULL
  )
  UPDATE enrollments e
  SET next_run_at = NOW(),
      updated_at = NOW()
  FROM pause_deferred_enrollments pde
  WHERE e.id = pde.enrollment_id
    AND e.deleted_at IS NULL
    AND e.state = 'active';

  GET DIAGNOSTICS v_pause_rearmed_enrollments = ROW_COUNT;
  v_rescheduled_jobs := v_rescheduled_jobs + v_pause_rearmed_enrollments;

  UPDATE campaigns
  SET
    status = 'running',
    updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL;

  RETURN QUERY SELECT 0, v_rescheduled_jobs;
END;
$$;
