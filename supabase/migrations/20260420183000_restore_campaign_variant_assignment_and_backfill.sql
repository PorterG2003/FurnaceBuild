-- Restore campaign variant assignment after later batch_assign_jobs_to_interval rewrites
-- dropped merge_email_variant_into_message_job / message_jobs.variant_id writes.
-- Also normalize legacy email nodes and backfill deterministic single-variant jobs.

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
  v_merged JSONB;
  v_variant_id UUID;
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
  RETURNING campaign_intervals.id, campaign_intervals.interval_time
  INTO v_interval_id, v_interval_time;

  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE campaign_intervals
  SET
    required_mailbox_count = COALESCE(p_required_mailbox_count, required_mailbox_count),
    updated_at = NOW()
  WHERE id = v_interval_id;

  FOREACH v_job_data IN ARRAY COALESCE(p_job_data, ARRAY[]::JSONB[])
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
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.enrollment_id = v_enrollment_id
      AND mj.node_id = v_node_id
      AND mj.status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT m.merged_message_data, m.chosen_variant_id
    INTO v_merged, v_variant_id
    FROM merge_email_variant_into_message_job(
      p_campaign_id,
      v_node_id,
      COALESCE(v_message_data->'lead_data', '{}'::JSONB),
      v_message_data
    ) AS m(merged_message_data, chosen_variant_id);

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
      variant_id,
      flow_version_number,
      message_type
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
      v_merged,
      v_variant_id,
      v_flow_version_number,
      'campaign'
    );

    v_job_count := v_job_count + 1;
  END LOOP;

  UPDATE campaign_intervals
  SET
    status = CASE
      WHEN v_job_count > 0 OR expected_job_count > 0 THEN 'scheduled'
      ELSE 'available'
    END,
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;

  PERFORM public.complete_campaign_interval_if_ready(v_interval_id);

  RETURN QUERY
  SELECT
    v_job_count AS jobs_created,
    v_interval_id AS interval_id,
    v_interval_time AS interval_time;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION batch_assign_jobs_to_interval(UUID, JSONB[], TEXT, INTEGER) IS
  'Atomically locks an interval, creates campaign message_jobs with variant-aware message_data/variant_id, and updates interval progress counters.';

DO $$
DECLARE
  v_legacy_id CONSTANT UUID := 'a0000000-0000-4000-8000-000000000001'::UUID;
  rec RECORD;
  v_fd JSONB;
  v_nodes JSONB;
  v_new_nodes JSONB;
  v_elem JSONB;
  v_data JSONB;
  v_variant JSONB;
  v_new_data JSONB;
  v_new_elem JSONB;
  v_changed BOOLEAN;
  i INT;
  v_len INT;
  v_campaigns_updated BIGINT := 0;
  v_jobs_updated BIGINT := 0;
BEGIN
  FOR rec IN
    SELECT id, flow_data
    FROM campaigns
    WHERE flow_data IS NOT NULL
      AND deleted_at IS NULL
  LOOP
    v_fd := rec.flow_data;
    v_nodes := v_fd -> 'nodes';

    IF v_nodes IS NULL OR jsonb_typeof(v_nodes) <> 'array' THEN
      CONTINUE;
    END IF;

    v_new_nodes := '[]'::JSONB;
    v_changed := FALSE;
    v_len := jsonb_array_length(v_nodes);

    FOR i IN 0 .. v_len - 1 LOOP
      v_elem := v_nodes -> i;

      IF (v_elem ->> 'type') IS DISTINCT FROM 'email' THEN
        v_new_nodes := v_new_nodes || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;

      v_data := COALESCE(v_elem -> 'data', '{}'::JSONB);

      IF (v_data ? 'variants')
         AND jsonb_typeof(v_data -> 'variants') = 'array'
         AND jsonb_array_length(COALESCE(v_data -> 'variants', '[]'::JSONB)) > 0
      THEN
        v_new_nodes := v_new_nodes || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;

      v_variant := jsonb_build_object(
        'id', v_legacy_id::TEXT,
        'label', 'A',
        'subject', COALESCE(v_data ->> 'subject', ''),
        'template', COALESCE(v_data ->> 'template', ''),
        'body_html', v_data -> 'body_html',
        'body_text', v_data -> 'body_text',
        'isActive', to_jsonb(TRUE),
        'order', to_jsonb(0)
      );

      v_new_data := v_data || jsonb_build_object('variants', jsonb_build_array(v_variant));
      v_new_elem := jsonb_set(v_elem, '{data}', v_new_data, TRUE);
      v_new_nodes := v_new_nodes || jsonb_build_array(v_new_elem);
      v_changed := TRUE;
    END LOOP;

    IF v_changed THEN
      UPDATE campaigns
      SET
        flow_data = jsonb_set(v_fd, '{nodes}', v_new_nodes, TRUE),
        updated_at = NOW()
      WHERE id = rec.id;

      v_campaigns_updated := v_campaigns_updated + 1;
    END IF;
  END LOOP;

  WITH deterministic_variant_map AS (
    SELECT
      n.campaign_id,
      n.id AS node_id,
      (n.node_data -> 'variants' -> 0 ->> 'id')::UUID AS variant_id,
      COALESCE(NULLIF(n.node_data -> 'variants' -> 0 ->> 'label', ''), 'A') AS variant_label
    FROM nodes n
    WHERE n.deleted_at IS NULL
      AND n.node_type = 'email'
      AND n.node_data ? 'variants'
      AND jsonb_typeof(n.node_data -> 'variants') = 'array'
      AND jsonb_array_length(n.node_data -> 'variants') = 1
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      variant_id = dvm.variant_id,
      message_data = jsonb_set(
        COALESCE(mj.message_data, '{}'::JSONB),
        '{variant}',
        jsonb_build_object(
          'id', dvm.variant_id::TEXT,
          'label_snapshot', dvm.variant_label
        ),
        TRUE
      ),
      updated_at = NOW()
    FROM deterministic_variant_map dvm
    WHERE mj.campaign_id = dvm.campaign_id
      AND mj.node_id = dvm.node_id
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.variant_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*)::BIGINT
  INTO v_jobs_updated
  FROM updated_jobs;

  RAISE NOTICE 'campaign_variant_backfill: campaigns normalized = %, jobs updated = %',
    v_campaigns_updated,
    v_jobs_updated;
END;
$$;
