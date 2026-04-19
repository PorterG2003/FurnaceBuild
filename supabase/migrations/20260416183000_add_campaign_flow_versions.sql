-- Persist campaign flow snapshots for audit/debugging and stamp runtime artifacts
-- with the flow version that produced them.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS current_flow_version_number INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaigns_current_flow_version_number_nonnegative'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_current_flow_version_number_nonnegative
      CHECK (current_flow_version_number >= 0);
  END IF;
END $$;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS current_flow_version_number INTEGER;

ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS flow_version_number INTEGER;

CREATE TABLE IF NOT EXISTS campaign_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  flow_data JSONB,
  flow_hash TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  change_source TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_campaign_flow_versions_campaign_version
  ON campaign_flow_versions(campaign_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_flow_versions_account_changed_at
  ON campaign_flow_versions(account_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_flow_versions_changed_by_user
  ON campaign_flow_versions(changed_by_user_id, changed_at DESC)
  WHERE changed_by_user_id IS NOT NULL;

COMMENT ON TABLE campaign_flow_versions IS
  'Append-only snapshots of campaign flow_data for audit and debugging.';

COMMENT ON COLUMN campaign_flow_versions.version_number IS
  'Monotonic version number for a campaign flow. campaigns.current_flow_version_number points to the active version.';

COMMENT ON COLUMN campaign_flow_versions.flow_hash IS
  'MD5 hash of flow_data::text for quick equality checks in diagnostics.';

UPDATE campaigns
SET current_flow_version_number = CASE
  WHEN flow_data IS NULL THEN 0
  ELSE 1
END;

INSERT INTO campaign_flow_versions (
  campaign_id,
  account_id,
  version_number,
  flow_data,
  flow_hash,
  changed_at,
  changed_by_user_id,
  change_source,
  created_at
)
SELECT
  c.id,
  c.account_id,
  1,
  c.flow_data,
  md5(COALESCE(c.flow_data::TEXT, 'null')),
  COALESCE(c.updated_at, c.created_at, NOW()),
  NULL,
  'backfill',
  COALESCE(c.updated_at, c.created_at, NOW())
FROM campaigns c
WHERE c.flow_data IS NOT NULL
  AND c.account_id IS NOT NULL
ON CONFLICT (campaign_id, version_number) DO NOTHING;

CREATE OR REPLACE FUNCTION resolve_campaign_flow_change_source()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_override TEXT := NULLIF(current_setting('app.change_source', true), '');
  v_app_name TEXT := NULLIF(current_setting('application_name', true), '');
BEGIN
  RETURN COALESCE(
    v_override,
    CASE
      WHEN v_user_id IS NOT NULL THEN 'app'
      WHEN v_app_name IS NOT NULL THEN v_app_name
      ELSE current_user
    END,
    'unknown'
  );
END;
$$;

CREATE OR REPLACE FUNCTION prepare_campaign_flow_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_version INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.current_flow_version_number := CASE
      WHEN NEW.flow_data IS NULL OR NEW.account_id IS NULL THEN 0
      WHEN COALESCE(NEW.current_flow_version_number, 0) > 0 THEN NEW.current_flow_version_number
      ELSE 1
    END;
    RETURN NEW;
  END IF;

  NEW.current_flow_version_number := COALESCE(OLD.current_flow_version_number, 0);

  IF OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data THEN
    RETURN NEW;
  END IF;

  IF NEW.account_id IS NULL THEN
    NEW.current_flow_version_number := COALESCE(OLD.current_flow_version_number, 0);
    RETURN NEW;
  END IF;

  v_next_version := COALESCE(OLD.current_flow_version_number, 0) + 1;
  NEW.current_flow_version_number := v_next_version;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION store_campaign_flow_version_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_by_user_id UUID := auth.uid();
  v_change_source TEXT := resolve_campaign_flow_change_source();
  v_changed_at TIMESTAMPTZ := COALESCE(NEW.updated_at, NOW());
BEGIN
  IF NEW.flow_data IS NULL
     OR NEW.account_id IS NULL
     OR COALESCE(NEW.current_flow_version_number, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data THEN
    RETURN NEW;
  END IF;

  INSERT INTO campaign_flow_versions (
    campaign_id,
    account_id,
    version_number,
    flow_data,
    flow_hash,
    changed_at,
    changed_by_user_id,
    change_source,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.account_id,
    NEW.current_flow_version_number,
    NEW.flow_data,
    md5(COALESCE(NEW.flow_data::TEXT, 'null')),
    v_changed_at,
    v_changed_by_user_id,
    v_change_source,
    v_changed_at
  )
  ON CONFLICT (campaign_id, version_number) DO UPDATE
  SET
    flow_data = EXCLUDED.flow_data,
    flow_hash = EXCLUDED.flow_hash,
    changed_at = EXCLUDED.changed_at,
    changed_by_user_id = EXCLUDED.changed_by_user_id,
    change_source = EXCLUDED.change_source;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_campaign_flow_version_trigger ON campaigns;
CREATE TRIGGER prepare_campaign_flow_version_trigger
  BEFORE INSERT OR UPDATE OF flow_data ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION prepare_campaign_flow_version();

DROP TRIGGER IF EXISTS store_campaign_flow_version_snapshot_trigger ON campaigns;
CREATE TRIGGER store_campaign_flow_version_snapshot_trigger
  AFTER INSERT OR UPDATE OF flow_data ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION store_campaign_flow_version_snapshot();

ALTER TABLE campaign_flow_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_flow_versions_select_member" ON campaign_flow_versions;
CREATE POLICY "campaign_flow_versions_select_member"
  ON campaign_flow_versions FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_campaign_flow_data(
  p_campaign_id UUID,
  p_flow_data JSONB,
  p_change_source TEXT DEFAULT 'builder'
)
RETURNS campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_campaign campaigns;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM campaigns c
    INNER JOIN account_users au
      ON au.account_id = c.account_id
    WHERE c.id = p_campaign_id
      AND c.deleted_at IS NULL
      AND au.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Campaign not found or access denied';
  END IF;

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE campaigns
  SET flow_data = p_flow_data,
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  RETURN v_campaign;
END;
$$;

COMMENT ON FUNCTION update_campaign_flow_data(UUID, JSONB, TEXT) IS
  'Updates campaigns.flow_data while tagging the change source for flow version audit history.';

REVOKE ALL ON FUNCTION public.update_campaign_flow_data(UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_flow_data(UUID, JSONB, TEXT) TO authenticated;

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
  v_flow_version_number INTEGER;
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

    SELECT e.current_flow_version_number
    INTO v_flow_version_number
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
    LIMIT 1;

    IF NOT FOUND THEN
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
      message_data,
      flow_version_number
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
      v_message_data,
      v_flow_version_number
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
