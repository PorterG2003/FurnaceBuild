-- ============================================
-- Migration: Soft delete message_job parents + FK hardening
-- ============================================
-- Preserves message_jobs history when users delete campaigns, mailboxes, leads,
-- enrollments, or nodes. App delete flows move to deleted_at, message_jobs FKs
-- become RESTRICT, and worker/RPC entry points skip deleted parents.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaigns_active_account_created_at
  ON campaigns (account_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mailboxes_active_account_created_at
  ON mailboxes (account_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_active_campaign_created_at
  ON leads (campaign_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_active_bucket_created_at
  ON leads (bucket_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_active_ready_not_deleted
  ON enrollments (next_run_at, state)
  WHERE state = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_active_campaign_type
  ON nodes (campaign_id, node_type)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION sync_campaign_nodes()
RETURNS TRIGGER AS $$
DECLARE
  flow_nodes JSONB;
  flow_node JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data THEN
    RETURN NEW;
  END IF;

  flow_nodes := COALESCE(NEW.flow_data->'nodes', '[]'::jsonb);

  IF jsonb_typeof(flow_nodes) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR flow_node IN SELECT * FROM jsonb_array_elements(flow_nodes)
  LOOP
    INSERT INTO nodes (
      campaign_id,
      flow_node_id,
      node_type,
      node_data,
      position_x,
      position_y,
      deleted_at
    ) VALUES (
      NEW.id,
      flow_node->>'id',
      flow_node->>'type',
      COALESCE(flow_node->'data', '{}'::jsonb),
      (flow_node->'position'->>'x')::REAL,
      (flow_node->'position'->>'y')::REAL,
      NULL
    )
    ON CONFLICT (campaign_id, flow_node_id)
    DO UPDATE SET
      node_type = EXCLUDED.node_type,
      node_data = EXCLUDED.node_data,
      position_x = EXCLUDED.position_x,
      position_y = EXCLUDED.position_y,
      deleted_at = NULL,
      updated_at = NOW();
  END LOOP;

  UPDATE nodes
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE nodes.campaign_id = NEW.id
    AND nodes.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(flow_nodes) AS active_node
      WHERE active_node->>'id' = nodes.flow_node_id
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS message_jobs_enrollment_id_fkey;
ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS message_jobs_campaign_id_fkey;
ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS message_jobs_lead_id_fkey;
ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS message_jobs_mailbox_id_fkey;
ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS message_jobs_node_id_fkey;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_enrollment_id_fkey
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE RESTRICT;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_mailbox_id_fkey
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE RESTRICT;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_node_id_fkey
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE RESTRICT;

REVOKE DELETE ON campaigns, mailboxes, leads, enrollments, nodes, message_jobs FROM authenticated;

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
DECLARE
  v_claimed_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT mj.id
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
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_jobs AS (
    UPDATE message_jobs
    SET status = 'reserved',
        reserved_at = NOW(),
        updated_at = NOW()
    WHERE message_jobs.id = ANY(v_claimed_ids)
      AND message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND message_jobs.message_type IN ('inbox_reply', 'inbox_forward')
      AND EXISTS (
        SELECT 1
        FROM mailboxes m
        WHERE m.id = message_jobs.mailbox_id
          AND m.deleted_at IS NULL
      )
    RETURNING
      message_jobs.id,
      message_jobs.enrollment_id,
      message_jobs.campaign_id,
      message_jobs.lead_id,
      message_jobs.mailbox_id,
      message_jobs.node_id,
      message_jobs.message_type,
      message_jobs.status,
      message_jobs.scheduled_at,
      message_jobs.reserved_at,
      message_jobs.sent_at,
      message_jobs.provider_message_id,
      message_jobs.error_message,
      message_jobs.retry_count,
      message_jobs.max_retries,
      message_jobs.message_data,
      message_jobs.created_at,
      message_jobs.updated_at
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
DECLARE
  v_claimed_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT mj.id
    FROM message_jobs mj
    WHERE mj.status = 'pending'
      AND mj.scheduled_at <= NOW()
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND EXISTS (
        SELECT 1
        FROM campaigns c
        WHERE c.id = mj.campaign_id
          AND c.status = 'running'
          AND c.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM mailboxes m
        WHERE m.id = mj.mailbox_id
          AND m.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM leads l
        WHERE l.id = mj.lead_id
          AND l.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM enrollments e
        WHERE e.id = mj.enrollment_id
          AND e.deleted_at IS NULL
      )
      AND (
        mj.node_id IS NULL OR EXISTS (
          SELECT 1
          FROM nodes n
          WHERE n.id = mj.node_id
            AND n.deleted_at IS NULL
        )
      )
    ORDER BY mj.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_jobs AS (
    UPDATE message_jobs
    SET status = 'reserved',
        reserved_at = NOW(),
        updated_at = NOW()
    WHERE message_jobs.id = ANY(v_claimed_ids)
      AND message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND (message_jobs.message_type = 'campaign' OR message_jobs.message_type IS NULL)
      AND EXISTS (
        SELECT 1
        FROM campaigns c
        WHERE c.id = message_jobs.campaign_id
          AND c.status = 'running'
          AND c.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM mailboxes m
        WHERE m.id = message_jobs.mailbox_id
          AND m.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM leads l
        WHERE l.id = message_jobs.lead_id
          AND l.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM enrollments e
        WHERE e.id = message_jobs.enrollment_id
          AND e.deleted_at IS NULL
      )
      AND (
        message_jobs.node_id IS NULL OR EXISTS (
          SELECT 1
          FROM nodes n
          WHERE n.id = message_jobs.node_id
            AND n.deleted_at IS NULL
        )
      )
    RETURNING
      message_jobs.id,
      message_jobs.enrollment_id,
      message_jobs.campaign_id,
      message_jobs.lead_id,
      message_jobs.mailbox_id,
      message_jobs.node_id,
      message_jobs.message_type,
      message_jobs.status,
      message_jobs.scheduled_at,
      message_jobs.reserved_at,
      message_jobs.sent_at,
      message_jobs.provider_message_id,
      message_jobs.error_message,
      message_jobs.retry_count,
      message_jobs.max_retries,
      message_jobs.message_data,
      message_jobs.created_at,
      message_jobs.updated_at
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
DECLARE
  v_claimed_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT e.id
    FROM enrollments e
    WHERE e.state = 'active'
      AND e.deleted_at IS NULL
      AND e.next_run_at <= NOW()
      AND EXISTS (
        SELECT 1
        FROM campaigns c
        WHERE c.id = e.campaign_id
          AND c.status = 'running'
          AND c.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM leads l
        WHERE l.id = e.lead_id
          AND l.deleted_at IS NULL
      )
      AND (
        e.current_node_id IS NULL OR EXISTS (
          SELECT 1
          FROM nodes n
          WHERE n.id = e.current_node_id
            AND n.deleted_at IS NULL
        )
      )
    ORDER BY e.next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF e SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_enrollments AS (
    UPDATE enrollments
    SET next_run_at = NOW() + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE enrollments.id = ANY(v_claimed_ids)
      AND enrollments.state = 'active'
      AND enrollments.deleted_at IS NULL
      AND enrollments.next_run_at <= NOW()
      AND EXISTS (
        SELECT 1
        FROM campaigns c
        WHERE c.id = enrollments.campaign_id
          AND c.status = 'running'
          AND c.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM leads l
        WHERE l.id = enrollments.lead_id
          AND l.deleted_at IS NULL
      )
      AND (
        enrollments.current_node_id IS NULL OR EXISTS (
          SELECT 1
          FROM nodes n
          WHERE n.id = enrollments.current_node_id
            AND n.deleted_at IS NULL
        )
      )
    RETURNING
      enrollments.id,
      enrollments.campaign_id,
      enrollments.lead_id,
      enrollments.current_node_id,
      enrollments.state,
      enrollments.next_run_at,
      enrollments.flow_position,
      enrollments.created_at,
      enrollments.updated_at
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
  FROM updated_enrollments;
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
  v_claimed_ids UUID[];
  v_processing_timeout TIMESTAMPTZ;
BEGIN
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;

  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT mailboxes.id
    FROM mailboxes
    WHERE mailboxes.deleted_at IS NULL
      AND mailboxes.status = 'connected'
      AND mailboxes.email_address NOT LIKE '%@furnace.test'
      AND (
        mailboxes.last_synced_at IS NULL
        OR mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR (mailboxes.last_synced_at < v_processing_timeout AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
      AND (mailboxes.imap_claimed_at IS NULL OR mailboxes.imap_claimed_at < v_processing_timeout)
    ORDER BY
      CASE
        WHEN mailboxes.last_synced_at IS NULL THEN 1
        WHEN mailboxes.last_synced_at < v_processing_timeout THEN 2
        ELSE 3
      END,
      mailboxes.last_synced_at ASC NULLS FIRST
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_mailboxes AS (
    UPDATE mailboxes
    SET imap_claimed_at = NOW(),
        updated_at = NOW()
    WHERE mailboxes.id = ANY(v_claimed_ids)
      AND mailboxes.deleted_at IS NULL
      AND mailboxes.status = 'connected'
      AND mailboxes.email_address NOT LIKE '%@furnace.test'
      AND (
        mailboxes.last_synced_at IS NULL
        OR mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR (mailboxes.last_synced_at < v_processing_timeout AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
      AND (mailboxes.imap_claimed_at IS NULL OR mailboxes.imap_claimed_at < v_processing_timeout)
    RETURNING
      mailboxes.id,
      mailboxes.account_id,
      mailboxes.user_id,
      mailboxes.email_address,
      mailboxes.display_name,
      mailboxes.provider,
      mailboxes.smtp_host,
      mailboxes.smtp_port,
      mailboxes.smtp_username,
      mailboxes.smtp_password,
      mailboxes.smtp_use_tls,
      mailboxes.smtp_use_ssl,
      mailboxes.imap_host,
      mailboxes.imap_port,
      mailboxes.imap_username,
      mailboxes.imap_password,
      mailboxes.imap_use_ssl,
      mailboxes.status,
      mailboxes.last_synced_at,
      mailboxes.error_message,
      mailboxes.created_at,
      mailboxes.updated_at
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
  ORDER BY
    CASE
      WHEN updated_mailboxes.last_synced_at IS NULL THEN 1
      WHEN updated_mailboxes.last_synced_at < v_processing_timeout THEN 2
      ELSE 3
    END,
    updated_mailboxes.last_synced_at ASC NULLS FIRST;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION batch_assign_jobs_to_interval(
  p_campaign_id UUID,
  p_job_data JSONB[],
  p_worker_id TEXT DEFAULT 'scheduler'
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
  v_job_count INTEGER := 0;
  v_job_data JSONB;
  v_enrollment_id UUID;
  v_lead_id UUID;
  v_mailbox_id UUID;
  v_node_id UUID;
  v_message_data JSONB;
  v_jitter_percentage NUMERIC;
  v_scheduled_at TIMESTAMPTZ;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
  v_existing_job_id UUID;
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
    locked_by = p_worker_id,
    updated_at = NOW()
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
  RETURNING
    campaign_intervals.id,
    campaign_intervals.interval_time
  INTO v_interval_id, v_interval_time;

  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_job_data IN ARRAY p_job_data
  LOOP
    v_enrollment_id := (v_job_data->>'enrollment_id')::UUID;
    v_lead_id := (v_job_data->>'lead_id')::UUID;
    v_mailbox_id := (v_job_data->>'mailbox_id')::UUID;
    v_node_id := (v_job_data->>'node_id')::UUID;
    v_message_data := v_job_data->'message_data';
    v_jitter_percentage := COALESCE((v_job_data->>'jitter_percentage')::NUMERIC, 10.0);

    IF NOT EXISTS (
      SELECT 1
      FROM enrollments e
      INNER JOIN leads l
        ON l.id = e.lead_id
       AND l.deleted_at IS NULL
      INNER JOIN mailboxes m
        ON m.id = v_mailbox_id
       AND m.deleted_at IS NULL
      INNER JOIN nodes n
        ON n.id = v_node_id
       AND n.deleted_at IS NULL
      WHERE e.id = v_enrollment_id
        AND e.campaign_id = p_campaign_id
        AND e.lead_id = v_lead_id
        AND e.current_node_id = v_node_id
        AND e.state = 'active'
        AND e.deleted_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.mailbox_id = v_mailbox_id
      AND mj.interval_id = v_interval_id
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.enrollment_id = v_enrollment_id
      AND mj.node_id = v_node_id
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_jitter_range_seconds := v_interval_duration_seconds * (v_jitter_percentage / 100.0);
    v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
    v_scheduled_at := v_interval_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;

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
      message_data
    )
    VALUES (
      v_enrollment_id,
      p_campaign_id,
      v_account_id,
      v_lead_id,
      v_mailbox_id,
      v_node_id,
      v_interval_id,
      v_scheduled_at,
      'pending',
      v_message_data
    );

    v_job_count := v_job_count + 1;
  END LOOP;

  UPDATE campaign_intervals
  SET
    status = 'scheduled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;

  RETURN QUERY
  SELECT
    v_job_count AS jobs_created,
    v_interval_id AS interval_id,
    v_interval_time AS interval_time;
END;
$$ LANGUAGE plpgsql;

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
BEGIN
  SELECT
    mj.id,
    mj.mailbox_id,
    mj.status,
    mj.campaign_id,
    mj.lead_id,
    mj.enrollment_id,
    mj.node_id,
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

  IF v_message_job.mailbox_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Mailbox deleted';
  ELSIF v_message_job.campaign_id IS NOT NULL AND v_message_job.campaign_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Campaign deleted';
  ELSIF v_message_job.lead_id IS NOT NULL AND v_message_job.lead_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Lead deleted';
  ELSIF v_message_job.enrollment_id IS NOT NULL AND v_message_job.enrollment_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Enrollment deleted';
  ELSIF v_message_job.node_id IS NOT NULL AND v_message_job.node_deleted_at IS NOT NULL THEN
    v_parent_failure_reason := 'Node deleted';
  END IF;

  IF v_parent_failure_reason IS NOT NULL THEN
    UPDATE message_jobs
    SET status = 'cancelled',
        reserved_at = NULL,
        error_message = v_parent_failure_reason,
        updated_at = NOW()
    WHERE id = p_message_job_id;
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

  IF v_throttle.sent_count >= COALESCE(v_throttle.daily_limit, 50) THEN
    UPDATE message_jobs
    SET status = 'pending',
        reserved_at = NULL,
        scheduled_at = (v_today + INTERVAL '1 day'),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, 'Daily throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);
  IF v_hourly_count >= COALESCE(v_throttle.hourly_limit, 10) THEN
    UPDATE message_jobs
    SET status = 'pending',
        reserved_at = NULL,
        scheduled_at = date_trunc('hour', NOW()) + INTERVAL '1 hour',
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_message_job_id;
    RETURN QUERY SELECT false, 'Hourly throttle limit exceeded'::TEXT;
    RETURN;
  END IF;

  IF v_throttle.last_sent_at IS NOT NULL THEN
    v_time_since_last_send := NOW() - v_throttle.last_sent_at;
    IF v_time_since_last_send < INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180) THEN
      UPDATE message_jobs
      SET status = 'pending',
          reserved_at = NULL,
          scheduled_at = v_throttle.last_sent_at + INTERVAL '1 second' * COALESCE(v_throttle.min_gap_seconds, 180),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = p_message_job_id;
      RETURN QUERY SELECT false, 'Minimum gap between sends not met'::TEXT;
      RETURN;
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION get_campaign_contacted_counts(p_campaign_ids UUID[])
RETURNS TABLE(campaign_id UUID, contacted_count INT) AS $$
BEGIN
  RETURN QUERY
    SELECT mj.campaign_id, COUNT(DISTINCT mj.enrollment_id)::int AS contacted_count
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.deleted_at IS NULL
     AND (auth.uid() IS NULL OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.deleted_at IS NULL
    WHERE mj.campaign_id = ANY(p_campaign_ids)
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    GROUP BY mj.campaign_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
