ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_message_jobs_reserved_lease_expires_at
  ON message_jobs(lease_expires_at)
  WHERE status = 'reserved'
    AND (message_type = 'campaign' OR message_type IS NULL);

CREATE INDEX IF NOT EXISTS idx_message_jobs_live_mailbox_state
  ON message_jobs(mailbox_id, status, lease_expires_at, sending_started_at)
  WHERE status IN ('reserved', 'sending');

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
        'campaign_paused',
        'transient_read_error'
      );
    WHEN 'failed' THEN
      RETURN p_status_reason IN (
        'provider_error',
        'template_render_error',
        'uncertain_send_state'
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

  IF (v_throttle.sent_count + v_inflight_count) >= COALESCE(v_throttle.daily_limit, 50) THEN
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
      lease_expires_at = NOW() + make_interval(mins => p_processing_timeout_minutes),
      claim_token = gen_random_uuid()::TEXT,
      sending_started_at = NULL,
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

CREATE OR REPLACE FUNCTION public.reclaim_stale_campaign_message_jobs(
  p_batch_size INTEGER DEFAULT 50,
  p_rearm_delay_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  message_job_id UUID,
  enrollment_id UUID,
  campaign_id UUID
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.enrollment_id, mj.campaign_id
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.status = 'running'
     AND c.deleted_at IS NULL
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
      AND mj.lease_expires_at IS NOT NULL
      AND mj.lease_expires_at < NOW()
      AND (mj.node_id IS NULL OR (n.id IS NOT NULL AND n.deleted_at IS NULL))
      AND NOT EXISTS (
        SELECT 1
        FROM message_jobs newer
        WHERE newer.enrollment_id = mj.enrollment_id
          AND newer.node_id IS NOT DISTINCT FROM mj.node_id
          AND (newer.message_type = 'campaign' OR newer.message_type IS NULL)
          AND newer.created_at > mj.created_at
      )
    ORDER BY mj.lease_expires_at ASC
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
      updated_at = NOW()
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING mj.id, mj.enrollment_id, mj.campaign_id
  ),
  rearmed_enrollments AS (
    UPDATE enrollments e
    SET
      next_run_at = NOW() + make_interval(secs => p_rearm_delay_seconds),
      updated_at = NOW()
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

CREATE OR REPLACE FUNCTION public.finalize_message_job_sent(
  p_message_job_id UUID,
  p_provider_message_id TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN AS $$
DECLARE
  v_message_job RECORD;
  v_today DATE;
  v_current_hour INTEGER;
  v_throttle RECORD;
  v_hourly_count INTEGER;
BEGIN
  SELECT
    mj.id,
    mj.mailbox_id
  INTO v_message_job
  FROM message_jobs mj
  WHERE mj.id = p_message_job_id
    AND mj.status = 'sending'
  FOR UPDATE OF mj;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_today := (p_sent_at AT TIME ZONE 'UTC')::DATE;
  v_current_hour := EXTRACT(HOUR FROM p_sent_at)::INTEGER;

  SELECT * INTO v_throttle
  FROM mailbox_throttles
  WHERE mailbox_id = v_message_job.mailbox_id
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
      min_gap_seconds,
      last_sent_at,
      updated_at
    )
    SELECT
      m.id,
      m.account_id,
      v_today,
      0,
      '{}'::JSONB,
      COALESCE(m.daily_limit, 50),
      COALESCE(m.hourly_limit, 10),
      COALESCE(m.min_gap_seconds, 180),
      NULL,
      NOW()
    FROM mailboxes m
    WHERE m.id = v_message_job.mailbox_id
    ON CONFLICT (mailbox_id, date) DO NOTHING
    RETURNING * INTO v_throttle;

    IF NOT FOUND THEN
      SELECT * INTO v_throttle
      FROM mailbox_throttles
      WHERE mailbox_id = v_message_job.mailbox_id
        AND date = v_today
      FOR UPDATE;
    END IF;
  END IF;

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);

  UPDATE mailbox_throttles
  SET sent_count = sent_count + 1,
      hourly_sent = jsonb_set(
        COALESCE(hourly_sent, '{}'::JSONB),
        ARRAY[v_current_hour::TEXT],
        to_jsonb(v_hourly_count + 1)
      ),
      last_sent_at = p_sent_at,
      updated_at = NOW()
  WHERE mailbox_id = v_message_job.mailbox_id
    AND date = v_today;

  UPDATE message_jobs
  SET status = 'sent',
      status_reason = 'sent_successfully',
      sent_at = p_sent_at,
      provider_message_id = p_provider_message_id,
      lease_expires_at = NULL,
      claim_token = NULL,
      updated_at = NOW()
  WHERE id = p_message_job_id
    AND status = 'sending';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.finalize_stale_sending_campaign_message_jobs(
  p_batch_size INTEGER DEFAULT 20,
  p_stale_minutes INTEGER DEFAULT 30
)
RETURNS TABLE (
  message_job_id UUID,
  enrollment_id UUID,
  campaign_id UUID
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.enrollment_id, mj.campaign_id
    FROM message_jobs mj
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.deleted_at IS NULL
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.deleted_at IS NULL
    WHERE mj.status = 'sending'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.sending_started_at IS NOT NULL
      AND mj.sending_started_at < NOW() - make_interval(mins => p_stale_minutes)
    ORDER BY mj.sending_started_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'failed',
      status_reason = 'uncertain_send_state',
      lease_expires_at = NULL,
      claim_token = NULL,
      error_message = COALESCE(
        NULLIF(mj.error_message, ''),
        'Sending attempt exceeded stale threshold; send outcome uncertain'
      ),
      updated_at = NOW()
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING mj.id, mj.enrollment_id, mj.campaign_id, mj.error_message
  ),
  stopped_enrollments AS (
    UPDATE enrollments e
    SET
      state = 'stopped',
      next_run_at = NULL,
      stopped_reason = 'error',
      stopped_at = COALESCE(e.stopped_at, NOW()),
      stopped_error_message = COALESCE(
        e.stopped_error_message,
        'Sending attempt entered uncertain state after stale timeout'
      ),
      updated_at = NOW()
    FROM updated_jobs uj
    WHERE e.id = uj.enrollment_id
      AND e.deleted_at IS NULL
      AND e.state IN ('active', 'paused')
    RETURNING e.id
  )
  SELECT
    uj.id AS message_job_id,
    uj.enrollment_id,
    uj.campaign_id
  FROM updated_jobs uj;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_job_self_recovery_health(
  p_reserved_stale_minutes INTEGER DEFAULT 5,
  p_sending_stale_minutes INTEGER DEFAULT 30
)
RETURNS TABLE (
  retryable_stopped_count BIGINT,
  stale_reserved_count BIGINT,
  stale_sending_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT COUNT(*)::BIGINT
      FROM enrollments e
      WHERE e.deleted_at IS NULL
        AND e.state = 'stopped'
        AND e.stopped_reason = 'error'
        AND COALESCE(e.stopped_error_message, '') ~* '(upstream request timeout|canceling statement due to statement timeout|jwt issued at future|gateway timeout|could not query the database for the schema cache\. retrying\.|code=pgrst002)'
    ) AS retryable_stopped_count,
    (
      SELECT COUNT(*)::BIGINT
      FROM message_jobs mj
      WHERE mj.status = 'reserved'
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
        AND (
          (mj.lease_expires_at IS NOT NULL AND mj.lease_expires_at < NOW())
          OR (
            mj.lease_expires_at IS NULL
            AND mj.reserved_at IS NOT NULL
            AND mj.reserved_at < NOW() - make_interval(mins => p_reserved_stale_minutes)
          )
        )
    ) AS stale_reserved_count,
    (
      SELECT COUNT(*)::BIGINT
      FROM message_jobs mj
      WHERE mj.status = 'sending'
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
        AND (
          (mj.sending_started_at IS NOT NULL AND mj.sending_started_at < NOW() - make_interval(mins => p_sending_stale_minutes))
          OR (
            mj.sending_started_at IS NULL
            AND mj.updated_at < NOW() - make_interval(mins => p_sending_stale_minutes)
          )
        )
    ) AS stale_sending_count;
END;
$$ LANGUAGE plpgsql;
