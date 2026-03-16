-- Extend cancel_smartlead_migration_run so that when the run is stale (no worker
-- heartbeat for 15+ minutes), the function immediately marks the run as cancelled
-- and inserts a run_cancelled event. One click then finalizes stuck runs without
-- requiring a live ECS worker.

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
  v_stale_minutes CONSTANT INTEGER := 15;
  v_stale_threshold TIMESTAMPTZ;
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

  -- If the run is stale (no heartbeat for 15+ min), immediately mark it cancelled
  -- so the UI updates without requiring a live worker.
  v_stale_threshold := NOW() - (v_stale_minutes || ' minutes')::INTERVAL;

  UPDATE smartlead_migration_runs
  SET
    status = 'cancelled',
    finished_at = NOW(),
    updated_at = NOW()
  WHERE id = p_run_id
    AND status IN ('running', 'launching', 'cancel_requested')
    AND (
      (last_heartbeat_at IS NULL AND (launched_at IS NULL OR launched_at < v_stale_threshold))
      OR (last_heartbeat_at < v_stale_threshold)
    );

  IF FOUND THEN
    -- Cancel any queued campaigns for this run (parity with worker finalizeRun).
    UPDATE smartlead_migration_campaigns
    SET
      status = 'cancelled',
      finished_at = NOW(),
      updated_at = NOW()
    WHERE run_id = p_run_id
      AND status = 'queued';

    INSERT INTO smartlead_migration_events (
      run_id,
      account_id,
      event_type,
      level,
      detail
    ) VALUES (
      p_run_id,
      v_account_id,
      'run_cancelled',
      'warning',
      'Migration cancelled (no active worker).'
    );
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION cancel_smartlead_migration_run IS
  'Marks a Smartlead migration run as cancel_requested. If the run is stale (no heartbeat for 15+ min), immediately sets status to cancelled and inserts run_cancelled event.';
