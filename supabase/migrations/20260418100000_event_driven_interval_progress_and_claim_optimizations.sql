ALTER TABLE campaign_intervals
  ADD COLUMN IF NOT EXISTS required_mailbox_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_mailbox_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_job_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_job_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN campaign_intervals.required_mailbox_count IS
  'Eligible mailbox count stamped onto the interval by the scheduler when jobs are assigned.';
COMMENT ON COLUMN campaign_intervals.assigned_mailbox_count IS
  'Distinct campaign mailbox count currently assigned to the interval.';
COMMENT ON COLUMN campaign_intervals.expected_job_count IS
  'Number of campaign message_jobs currently assigned to the interval.';
COMMENT ON COLUMN campaign_intervals.terminal_job_count IS
  'Number of assigned campaign message_jobs already in a terminal status.';

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_completion_progress
  ON campaign_intervals(campaign_id, status, interval_time)
  WHERE status IN ('scheduled', 'locked');

CREATE INDEX IF NOT EXISTS idx_mailboxes_imap_claim_ready
  ON mailboxes(imap_claimed_at, last_synced_at, id)
  WHERE deleted_at IS NULL
    AND status = 'connected';

CREATE OR REPLACE FUNCTION public.complete_campaign_interval_if_ready(
  p_interval_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_campaign_id UUID;
  v_interval_time TIMESTAMPTZ;
BEGIN
  IF p_interval_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE campaign_intervals ci
  SET
    status = 'completed',
    locked_at = NULL,
    locked_by = NULL
  WHERE ci.id = p_interval_id
    AND ci.status <> 'completed'
    AND ci.required_mailbox_count > 0
    AND ci.expected_job_count > 0
    AND ci.assigned_mailbox_count >= ci.required_mailbox_count
    AND ci.terminal_job_count >= ci.expected_job_count
  RETURNING ci.campaign_id, ci.interval_time
  INTO v_campaign_id, v_interval_time;

  IF v_campaign_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE campaigns
  SET last_completed_interval_time = CASE
    WHEN last_completed_interval_time IS NULL OR last_completed_interval_time < v_interval_time
      THEN v_interval_time
    ELSE last_completed_interval_time
  END
  WHERE id = v_campaign_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

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
          AND mj.status IN ('sent', 'failed', 'cancelled', 'blocked')
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

CREATE OR REPLACE FUNCTION public.refresh_campaign_interval_progress_from_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_interval_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT interval_id)
  INTO v_interval_ids
  FROM new_message_jobs
  WHERE interval_id IS NOT NULL
    AND (message_type = 'campaign' OR message_type IS NULL);

  PERFORM public.refresh_campaign_interval_progress_for_ids(v_interval_ids);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.refresh_campaign_interval_progress_from_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_interval_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT interval_id)
  INTO v_interval_ids
  FROM old_message_jobs
  WHERE interval_id IS NOT NULL
    AND (message_type = 'campaign' OR message_type IS NULL);

  PERFORM public.refresh_campaign_interval_progress_for_ids(v_interval_ids);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.refresh_campaign_interval_progress_from_update()
RETURNS TRIGGER AS $$
DECLARE
  v_interval_ids UUID[];
BEGIN
  WITH changed_intervals AS (
    SELECT interval_id
    FROM new_message_jobs
    WHERE interval_id IS NOT NULL
      AND (message_type = 'campaign' OR message_type IS NULL)
    UNION
    SELECT interval_id
    FROM old_message_jobs
    WHERE interval_id IS NOT NULL
      AND (message_type = 'campaign' OR message_type IS NULL)
  )
  SELECT ARRAY_AGG(DISTINCT interval_id)
  INTO v_interval_ids
  FROM changed_intervals;

  PERFORM public.refresh_campaign_interval_progress_for_ids(v_interval_ids);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_interval_progress_after_insert ON message_jobs;
CREATE TRIGGER trg_refresh_interval_progress_after_insert
AFTER INSERT ON message_jobs
REFERENCING NEW TABLE AS new_message_jobs
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_campaign_interval_progress_from_insert();

DROP TRIGGER IF EXISTS trg_refresh_interval_progress_after_delete ON message_jobs;
CREATE TRIGGER trg_refresh_interval_progress_after_delete
AFTER DELETE ON message_jobs
REFERENCING OLD TABLE AS old_message_jobs
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_campaign_interval_progress_from_delete();

DROP TRIGGER IF EXISTS trg_refresh_interval_progress_after_update ON message_jobs;
CREATE TRIGGER trg_refresh_interval_progress_after_update
AFTER UPDATE ON message_jobs
REFERENCING OLD TABLE AS old_message_jobs NEW TABLE AS new_message_jobs
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_campaign_interval_progress_from_update();

CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_interval_id UUID;
BEGIN
  FOR v_interval_id IN
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE (p_campaign_id IS NULL OR ci.campaign_id = p_campaign_id)
      AND ci.status IN ('scheduled', 'locked')
      AND ci.required_mailbox_count > 0
      AND ci.expected_job_count > 0
      AND ci.assigned_mailbox_count >= ci.required_mailbox_count
      AND ci.terminal_job_count >= ci.expected_job_count
    ORDER BY ci.interval_time ASC
  LOOP
    IF public.complete_campaign_interval_if_ready(v_interval_id) THEN
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_update_processed_intervals IS
  'Compatibility wrapper that finalizes intervals using interval-local progress counters instead of a global reconciliation scan.';

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
    WHERE mj.status = 'pending'
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
    WHERE mj.status = 'pending'
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
BEGIN
  RETURN QUERY
  WITH candidate_enrollments AS (
    SELECT e.id, e.next_run_at
    FROM enrollments e
    INNER JOIN campaigns c
      ON c.id = e.campaign_id
     AND c.status = 'running'
     AND c.deleted_at IS NULL
    INNER JOIN leads l
      ON l.id = e.lead_id
     AND l.deleted_at IS NULL
    LEFT JOIN nodes n
      ON n.id = e.current_node_id
     AND n.deleted_at IS NULL
    WHERE e.state = 'active'
      AND e.deleted_at IS NULL
      AND e.next_run_at <= NOW()
      AND (e.current_node_id IS NULL OR n.id IS NOT NULL)
    ORDER BY e.next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF e SKIP LOCKED
  ),
  updated_enrollments AS (
    UPDATE enrollments e
    SET
      next_run_at = NOW() + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
      updated_at = NOW()
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

DROP FUNCTION IF EXISTS claim_mailboxes_to_check(INTEGER, INTEGER, INTEGER);

CREATE FUNCTION claim_mailboxes_to_check(
  p_batch_size INTEGER DEFAULT 50,
  p_check_interval_minutes INTEGER DEFAULT 5,
  p_processing_timeout_minutes INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  account_id UUID,
  user_id UUID,
  email_address TEXT,
  display_name TEXT,
  provider TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  smtp_password TEXT,
  smtp_use_tls BOOLEAN,
  smtp_use_ssl BOOLEAN,
  imap_host TEXT,
  imap_port INTEGER,
  imap_username TEXT,
  imap_password TEXT,
  imap_use_ssl BOOLEAN,
  status TEXT,
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_processing_timeout TIMESTAMPTZ;
  v_check_cutoff TIMESTAMPTZ;
BEGIN
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;
  v_check_cutoff := NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL;

  RETURN QUERY
  WITH candidate_mailboxes AS (
    SELECT
      m.id,
      CASE
        WHEN m.last_synced_at IS NULL THEN 1
        WHEN m.last_synced_at < v_processing_timeout THEN 2
        ELSE 3
      END AS claim_priority
    FROM mailboxes m
    WHERE m.deleted_at IS NULL
      AND m.status = 'connected'
      AND m.email_address NOT LIKE '%@furnace.test'
      AND (m.imap_claimed_at IS NULL OR m.imap_claimed_at < v_processing_timeout)
      AND (
        m.last_synced_at IS NULL
        OR m.last_synced_at < v_check_cutoff
        OR (m.last_synced_at < v_processing_timeout AND m.last_synced_at > NOW() - INTERVAL '1 hour')
      )
    ORDER BY claim_priority ASC, m.last_synced_at ASC NULLS FIRST
    LIMIT p_batch_size
    FOR UPDATE OF m SKIP LOCKED
  ),
  updated_mailboxes AS (
    UPDATE mailboxes m
    SET
      imap_claimed_at = NOW(),
      updated_at = NOW()
    FROM candidate_mailboxes cm
    WHERE m.id = cm.id
    RETURNING
      m.id,
      m.account_id,
      m.user_id,
      m.email_address,
      m.display_name,
      m.provider,
      m.smtp_host,
      m.smtp_port,
      m.smtp_username,
      m.smtp_password,
      m.smtp_use_tls,
      m.smtp_use_ssl,
      m.imap_host,
      m.imap_port,
      m.imap_username,
      m.imap_password,
      m.imap_use_ssl,
      m.status,
      m.last_synced_at,
      m.error_message,
      m.created_at,
      m.updated_at
  )
  SELECT
    updated_mailboxes.id,
    updated_mailboxes.account_id,
    updated_mailboxes.user_id,
    updated_mailboxes.email_address,
    updated_mailboxes.display_name,
    updated_mailboxes.provider,
    updated_mailboxes.smtp_host,
    updated_mailboxes.smtp_port,
    updated_mailboxes.smtp_username,
    updated_mailboxes.smtp_password,
    updated_mailboxes.smtp_use_tls,
    updated_mailboxes.smtp_use_ssl,
    updated_mailboxes.imap_host,
    updated_mailboxes.imap_port,
    updated_mailboxes.imap_username,
    updated_mailboxes.imap_password,
    updated_mailboxes.imap_use_ssl,
    updated_mailboxes.status,
    updated_mailboxes.last_synced_at,
    updated_mailboxes.error_message,
    updated_mailboxes.created_at,
    updated_mailboxes.updated_at
  FROM updated_mailboxes
  ORDER BY updated_mailboxes.last_synced_at ASC NULLS FIRST;
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
        AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
    )
      AND NOT EXISTS (
        SELECT 1
        FROM message_jobs mj
        WHERE mj.enrollment_id = ij.enrollment_id
          AND mj.node_id = ij.node_id
          AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
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
      'pending',
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

WITH eligible_mailbox_counts AS (
  SELECT
    cm.campaign_id,
    COUNT(DISTINCT cm.mailbox_id)::INTEGER AS required_mailbox_count
  FROM campaign_mailboxes cm
  INNER JOIN mailboxes m
    ON m.id = cm.mailbox_id
   AND m.deleted_at IS NULL
   AND m.status = 'connected'
   AND m.smtp_status = 'active'
  GROUP BY cm.campaign_id
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
        AND mj.status IN ('sent', 'failed', 'cancelled', 'blocked')
    )::INTEGER AS terminal_job_count
  FROM message_jobs mj
  WHERE mj.interval_id IS NOT NULL
  GROUP BY mj.interval_id
),
interval_backfill AS (
  SELECT
    ci.id,
    COALESCE(emc.required_mailbox_count, 0) AS required_mailbox_count,
    COALESCE(ijc.expected_job_count, 0) AS expected_job_count,
    COALESCE(ijc.assigned_mailbox_count, 0) AS assigned_mailbox_count,
    COALESCE(ijc.terminal_job_count, 0) AS terminal_job_count
  FROM campaign_intervals ci
  LEFT JOIN eligible_mailbox_counts emc
    ON emc.campaign_id = ci.campaign_id
  LEFT JOIN interval_job_counts ijc
    ON ijc.interval_id = ci.id
)
UPDATE campaign_intervals ci
SET
  required_mailbox_count = ib.required_mailbox_count,
  expected_job_count = ib.expected_job_count,
  assigned_mailbox_count = ib.assigned_mailbox_count,
  terminal_job_count = ib.terminal_job_count
FROM interval_backfill ib
WHERE ci.id = ib.id;

SELECT check_and_update_processed_intervals(NULL);
