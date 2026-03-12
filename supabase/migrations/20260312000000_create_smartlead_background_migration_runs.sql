-- ============================================
-- Smartlead background migration runs
-- ============================================

CREATE TABLE IF NOT EXISTS smartlead_migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'launching', 'running', 'cancel_requested', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
  selected_campaign_count INTEGER NOT NULL DEFAULT 0,
  completed_campaign_count INTEGER NOT NULL DEFAULT 0,
  failed_campaign_count INTEGER NOT NULL DEFAULT 0,
  leads_imported INTEGER NOT NULL DEFAULT 0,
  conversations_imported INTEGER NOT NULL DEFAULT 0,
  totals_stats_campaign_count INTEGER NOT NULL DEFAULT 0,
  day_by_day_stats_campaign_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  current_campaign_id BIGINT NULL,
  current_campaign_name TEXT NULL,
  current_phase TEXT NULL
    CHECK (current_phase IS NULL OR current_phase IN ('campaign', 'leads', 'enrollments', 'conversations', 'stats', 'done')),
  current_detail TEXT NULL,
  last_error_message TEXT NULL,
  cancel_requested_at TIMESTAMPTZ NULL,
  launched_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  task_arn TEXT NULL,
  worker_id TEXT NULL,
  api_key_secret_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smartlead_migration_runs_account_created
  ON smartlead_migration_runs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smartlead_migration_runs_status
  ON smartlead_migration_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS smartlead_migration_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES smartlead_migration_runs(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  smartlead_campaign_id BIGINT NOT NULL,
  campaign_name TEXT NOT NULL,
  smartlead_created_at TIMESTAMPTZ NULL,
  furnace_campaign_id UUID NULL REFERENCES campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_phase TEXT NULL
    CHECK (last_phase IS NULL OR last_phase IN ('campaign', 'leads', 'enrollments', 'conversations', 'stats', 'done')),
  current_detail TEXT NULL,
  last_error_message TEXT NULL,
  leads_imported INTEGER NOT NULL DEFAULT 0,
  conversations_imported INTEGER NOT NULL DEFAULT 0,
  totals_stats_imported BOOLEAN NOT NULL DEFAULT FALSE,
  day_by_day_stats_imported BOOLEAN NOT NULL DEFAULT FALSE,
  replied_from_api INTEGER NOT NULL DEFAULT 0,
  leads_matched INTEGER NOT NULL DEFAULT 0,
  skipped_no_match INTEGER NOT NULL DEFAULT 0,
  skipped_empty_history INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  worker_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, smartlead_campaign_id),
  UNIQUE (run_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_smartlead_migration_campaigns_run_order
  ON smartlead_migration_campaigns (run_id, order_index);

CREATE INDEX IF NOT EXISTS idx_smartlead_migration_campaigns_run_status
  ON smartlead_migration_campaigns (run_id, status, order_index);

CREATE TABLE IF NOT EXISTS smartlead_migration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES smartlead_migration_runs(id) ON DELETE CASCADE,
  campaign_row_id UUID NULL REFERENCES smartlead_migration_campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warning', 'error')),
  phase TEXT NULL
    CHECK (phase IS NULL OR phase IN ('campaign', 'leads', 'enrollments', 'conversations', 'stats', 'done')),
  detail TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smartlead_migration_events_run_created
  ON smartlead_migration_events (run_id, created_at DESC);

ALTER TABLE smartlead_migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartlead_migration_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartlead_migration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "smartlead_migration_runs_select"
  ON smartlead_migration_runs
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "smartlead_migration_campaigns_select"
  ON smartlead_migration_campaigns
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "smartlead_migration_events_select"
  ON smartlead_migration_events
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION create_smartlead_migration_run(
  p_account_id UUID,
  p_selected_campaigns JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_campaign JSONB;
  v_index INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Account id is required';
  END IF;

  IF p_selected_campaigns IS NULL OR jsonb_typeof(p_selected_campaigns) <> 'array' OR jsonb_array_length(p_selected_campaigns) = 0 THEN
    RAISE EXCEPTION 'At least one Smartlead campaign is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM account_users
    WHERE account_id = p_account_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Account not found or access denied';
  END IF;

  INSERT INTO smartlead_migration_runs (
    account_id,
    created_by,
    status,
    selected_campaign_count
  ) VALUES (
    p_account_id,
    auth.uid(),
    'queued',
    jsonb_array_length(p_selected_campaigns)
  )
  RETURNING id INTO v_run_id;

  FOR v_campaign IN
    SELECT value
    FROM jsonb_array_elements(p_selected_campaigns)
  LOOP
    INSERT INTO smartlead_migration_campaigns (
      run_id,
      account_id,
      order_index,
      smartlead_campaign_id,
      campaign_name,
      smartlead_created_at,
      status
    ) VALUES (
      v_run_id,
      p_account_id,
      v_index,
      (v_campaign ->> 'id')::BIGINT,
      COALESCE(NULLIF(v_campaign ->> 'name', ''), 'Untitled campaign'),
      NULLIF(v_campaign ->> 'created_at', '')::TIMESTAMPTZ,
      'queued'
    );

    v_index := v_index + 1;
  END LOOP;

  INSERT INTO smartlead_migration_events (
    run_id,
    account_id,
    event_type,
    level,
    detail,
    payload
  ) VALUES (
    v_run_id,
    p_account_id,
    'run_created',
    'info',
    'Migration queued.',
    jsonb_build_object('selected_campaign_count', jsonb_array_length(p_selected_campaigns))
  );

  RETURN v_run_id;
END;
$$;

COMMENT ON FUNCTION create_smartlead_migration_run IS
  'Creates a Smartlead migration run and its child campaign rows for the authenticated user.';

CREATE OR REPLACE FUNCTION cancel_smartlead_migration_run(
  p_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT account_id
  INTO v_account_id
  FROM smartlead_migration_runs
  WHERE id = p_run_id
    AND account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    );

  IF v_account_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE smartlead_migration_runs
  SET
    status = CASE
      WHEN status IN ('queued', 'launching', 'running') THEN 'cancel_requested'
      ELSE status
    END,
    cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
    updated_at = NOW()
  WHERE id = p_run_id
    AND status IN ('queued', 'launching', 'running', 'cancel_requested');

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO smartlead_migration_events (
    run_id,
    account_id,
    event_type,
    level,
    detail
  ) VALUES (
    p_run_id,
    v_account_id,
    'cancel_requested',
    'warning',
    'Cancellation requested.'
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION cancel_smartlead_migration_run IS
  'Marks a Smartlead migration run as cancel_requested for the authenticated account member.';

CREATE OR REPLACE FUNCTION claim_smartlead_migration_run(
  p_run_id UUID,
  p_worker_id TEXT,
  p_task_arn TEXT DEFAULT NULL,
  p_processing_timeout_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timeout TIMESTAMPTZ;
BEGIN
  v_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;

  UPDATE smartlead_migration_runs
  SET
    status = 'running',
    worker_id = p_worker_id,
    task_arn = COALESCE(p_task_arn, task_arn),
    launched_at = COALESCE(launched_at, NOW()),
    started_at = COALESCE(started_at, NOW()),
    last_heartbeat_at = NOW(),
    updated_at = NOW()
  WHERE id = p_run_id
    AND (
      status IN ('queued', 'launching')
      OR (
        status = 'running'
        AND (last_heartbeat_at IS NULL OR last_heartbeat_at < v_timeout)
      )
    );

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION claim_smartlead_migration_run IS
  'Atomically claims a Smartlead migration run for a worker. Stale running rows may be reclaimed after the timeout.';

CREATE OR REPLACE FUNCTION claim_next_smartlead_migration_campaign(
  p_run_id UUID,
  p_worker_id TEXT,
  p_processing_timeout_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  run_id UUID,
  account_id UUID,
  order_index INTEGER,
  smartlead_campaign_id BIGINT,
  campaign_name TEXT,
  smartlead_created_at TIMESTAMPTZ,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_ids UUID[];
  v_timeout TIMESTAMPTZ;
BEGIN
  v_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;

  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT c.id
    FROM smartlead_migration_campaigns c
    WHERE c.run_id = p_run_id
      AND (
        c.status = 'queued'
        OR (
          c.status = 'running'
          AND (c.last_heartbeat_at IS NULL OR c.last_heartbeat_at < v_timeout)
        )
      )
    ORDER BY c.order_index ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_campaigns AS (
    UPDATE smartlead_migration_campaigns c
    SET
      status = 'running',
      attempt_count = c.attempt_count + 1,
      last_phase = 'campaign',
      current_detail = NULL,
      last_error_message = NULL,
      started_at = COALESCE(c.started_at, NOW()),
      last_heartbeat_at = NOW(),
      worker_id = p_worker_id,
      updated_at = NOW()
    WHERE c.id = ANY(v_claimed_ids)
      AND c.run_id = p_run_id
      AND (
        c.status = 'queued'
        OR (
          c.status = 'running'
          AND (c.last_heartbeat_at IS NULL OR c.last_heartbeat_at < v_timeout)
        )
      )
    RETURNING
      c.id,
      c.run_id,
      c.account_id,
      c.order_index,
      c.smartlead_campaign_id,
      c.campaign_name,
      c.smartlead_created_at,
      c.attempt_count
  )
  SELECT
    updated_campaigns.id,
    updated_campaigns.run_id,
    updated_campaigns.account_id,
    updated_campaigns.order_index,
    updated_campaigns.smartlead_campaign_id,
    updated_campaigns.campaign_name,
    updated_campaigns.smartlead_created_at,
    updated_campaigns.attempt_count
  FROM updated_campaigns;
END;
$$;

COMMENT ON FUNCTION claim_next_smartlead_migration_campaign IS
  'Claims the next queued Smartlead migration campaign row for a run. A stale running row may be reclaimed after the timeout.';
