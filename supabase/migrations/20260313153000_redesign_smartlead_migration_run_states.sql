ALTER TABLE smartlead_migration_runs
  ADD COLUMN IF NOT EXISTS launch_requested_at TIMESTAMPTZ NULL;

ALTER TABLE smartlead_migration_runs
  DROP CONSTRAINT IF EXISTS smartlead_migration_runs_status_check;

ALTER TABLE smartlead_migration_runs
  ADD CONSTRAINT smartlead_migration_runs_status_check
  CHECK (
    status IN (
      'queued',
      'launch_requested',
      'task_started',
      'running',
      'cancel_requested',
      'completed',
      'completed_with_warnings',
      'failed',
      'failed_to_launch',
      'failed_to_claim',
      'cancelled'
    )
  );

UPDATE smartlead_migration_runs
SET
  status = CASE
    WHEN status = 'launching' AND task_arn IS NULL THEN 'launch_requested'
    WHEN status = 'launching' AND task_arn IS NOT NULL AND started_at IS NULL THEN 'task_started'
    ELSE status
  END,
  launch_requested_at = COALESCE(
    launch_requested_at,
    CASE
      WHEN status = 'launching' THEN COALESCE(updated_at, created_at)
      ELSE NULL
    END
  ),
  launched_at = CASE
    WHEN status = 'launching' AND task_arn IS NULL THEN NULL
    ELSE launched_at
  END;

CREATE OR REPLACE FUNCTION reconcile_smartlead_migration_runs_for_account(
  p_account_id UUID,
  p_launch_timeout_seconds INTEGER DEFAULT 90,
  p_claim_timeout_seconds INTEGER DEFAULT 180
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finalized_count INTEGER := 0;
  v_step_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Account id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM account_users
    WHERE account_id = p_account_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Account not found or access denied';
  END IF;

  WITH cancelled_runs AS (
    UPDATE smartlead_migration_runs
    SET
      status = 'cancelled',
      current_phase = 'done',
      current_detail = 'Migration cancelled before the worker started.',
      current_campaign_id = NULL,
      current_campaign_name = NULL,
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
    WHERE account_id = p_account_id
      AND status = 'cancel_requested'
      AND started_at IS NULL
    RETURNING id, account_id
  )
  INSERT INTO smartlead_migration_events (
    run_id,
    account_id,
    event_type,
    level,
    phase,
    detail
  )
  SELECT
    id,
    account_id,
    'run_cancelled',
    'warning',
    'done',
    'Migration cancelled before the worker started.'
  FROM cancelled_runs;

  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_finalized_count := v_finalized_count + v_step_count;

  UPDATE smartlead_migration_campaigns
  SET
    status = 'cancelled',
    finished_at = COALESCE(finished_at, NOW()),
    updated_at = NOW()
  WHERE run_id IN (
    SELECT id
    FROM smartlead_migration_runs
    WHERE account_id = p_account_id
      AND status = 'cancelled'
      AND started_at IS NULL
  )
    AND status = 'queued';

  WITH failed_launch_runs AS (
    UPDATE smartlead_migration_runs
    SET
      status = 'failed_to_launch',
      last_error_message = COALESCE(
        NULLIF(last_error_message, ''),
        'Launch request timed out before ECS created a task.'
      ),
      current_phase = 'done',
      current_detail = NULL,
      current_campaign_id = NULL,
      current_campaign_name = NULL,
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
    WHERE account_id = p_account_id
      AND status = 'launch_requested'
      AND started_at IS NULL
      AND last_heartbeat_at IS NULL
      AND COALESCE(launch_requested_at, updated_at, created_at)
        < NOW() - make_interval(secs => GREATEST(p_launch_timeout_seconds, 1))
    RETURNING id, account_id, last_error_message
  )
  INSERT INTO smartlead_migration_events (
    run_id,
    account_id,
    event_type,
    level,
    phase,
    detail
  )
  SELECT
    id,
    account_id,
    'run_launch_timed_out',
    'error',
    'done',
    last_error_message
  FROM failed_launch_runs;

  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_finalized_count := v_finalized_count + v_step_count;

  WITH failed_claim_runs AS (
    UPDATE smartlead_migration_runs
    SET
      status = 'failed_to_claim',
      last_error_message = COALESCE(
        NULLIF(last_error_message, ''),
        'ECS created a task but the worker never claimed the run.'
      ),
      current_phase = 'done',
      current_detail = NULL,
      current_campaign_id = NULL,
      current_campaign_name = NULL,
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
    WHERE account_id = p_account_id
      AND status = 'task_started'
      AND started_at IS NULL
      AND last_heartbeat_at IS NULL
      AND COALESCE(launched_at, launch_requested_at, updated_at, created_at)
        < NOW() - make_interval(secs => GREATEST(p_claim_timeout_seconds, 1))
    RETURNING id, account_id, last_error_message
  )
  INSERT INTO smartlead_migration_events (
    run_id,
    account_id,
    event_type,
    level,
    phase,
    detail
  )
  SELECT
    id,
    account_id,
    'run_claim_timed_out',
    'error',
    'done',
    last_error_message
  FROM failed_claim_runs;

  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_finalized_count := v_finalized_count + v_step_count;

  RETURN v_finalized_count;
END;
$$;

COMMENT ON FUNCTION reconcile_smartlead_migration_runs_for_account IS
  'Finalizes stale Smartlead pre-claim runs for an account into cancelled, failed_to_launch, or failed_to_claim.';

CREATE OR REPLACE FUNCTION reconcile_smartlead_migration_run(
  p_run_id UUID,
  p_launch_timeout_seconds INTEGER DEFAULT 90,
  p_claim_timeout_seconds INTEGER DEFAULT 180
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

  PERFORM reconcile_smartlead_migration_runs_for_account(
    v_account_id,
    p_launch_timeout_seconds,
    p_claim_timeout_seconds
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION reconcile_smartlead_migration_run IS
  'Reconciles one Smartlead migration run by applying the account-level stalled-run finalizer.';

CREATE OR REPLACE FUNCTION cancel_smartlead_migration_run(
  p_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run smartlead_migration_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_run
  FROM smartlead_migration_runs
  WHERE id = p_run_id
    AND account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_run.status IN (
    'completed',
    'completed_with_warnings',
    'failed',
    'failed_to_launch',
    'failed_to_claim',
    'cancelled'
  ) THEN
    RETURN FALSE;
  END IF;

  IF v_run.started_at IS NULL THEN
    UPDATE smartlead_migration_runs
    SET
      status = 'cancelled',
      cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
      current_phase = 'done',
      current_detail = 'Migration cancelled before the worker started.',
      current_campaign_id = NULL,
      current_campaign_name = NULL,
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
    WHERE id = p_run_id;

    UPDATE smartlead_migration_campaigns
    SET
      status = 'cancelled',
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
    WHERE run_id = p_run_id
      AND status = 'queued';

    INSERT INTO smartlead_migration_events (
      run_id,
      account_id,
      event_type,
      level,
      phase,
      detail
    ) VALUES (
      p_run_id,
      v_run.account_id,
      'run_cancelled',
      'warning',
      'done',
      'Migration cancelled before the worker started.'
    );

    RETURN TRUE;
  END IF;

  IF v_run.status <> 'cancel_requested' THEN
    UPDATE smartlead_migration_runs
    SET
      status = 'cancel_requested',
      cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
      updated_at = NOW()
    WHERE id = p_run_id;

    INSERT INTO smartlead_migration_events (
      run_id,
      account_id,
      event_type,
      level,
      detail
    ) VALUES (
      p_run_id,
      v_run.account_id,
      'cancel_requested',
      'warning',
      'Cancellation requested.'
    );
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION cancel_smartlead_migration_run IS
  'Immediately cancels Smartlead runs that have not been claimed by a worker; otherwise marks them cancel_requested.';

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
      status IN ('queued', 'launch_requested', 'task_started')
      OR (
        status = 'running'
        AND (last_heartbeat_at IS NULL OR last_heartbeat_at < v_timeout)
      )
    );

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION claim_smartlead_migration_run IS
  'Atomically claims a Smartlead migration run for a worker. Only queued or pre-claim launched states may be claimed.';
