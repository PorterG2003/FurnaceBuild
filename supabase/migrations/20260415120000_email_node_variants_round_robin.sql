-- Email node A/B variants: round-robin state, message_jobs.variant_id, and batch_assign integration.

CREATE TABLE IF NOT EXISTS campaign_node_variant_state (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  next_index INTEGER NOT NULL DEFAULT 0,
  active_set_hash TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_node_variant_state_campaign
  ON campaign_node_variant_state (campaign_id);

COMMENT ON TABLE campaign_node_variant_state IS 'Per email node round-robin pointer and active-set hash for A/B variants.';

ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS variant_id UUID;

CREATE INDEX IF NOT EXISTS idx_message_jobs_campaign_node_variant
  ON message_jobs (campaign_id, node_id, variant_id)
  WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN message_jobs.variant_id IS 'Chosen email variant UUID from flow_data at job creation time.';

-- Merge lead_data from scheduler with chosen variant snapshot; lock round-robin state; return message_data + variant_id.
CREATE OR REPLACE FUNCTION merge_email_variant_into_message_job(
  p_campaign_id UUID,
  p_node_id UUID,
  p_lead_data JSONB,
  p_base_message_data JSONB
)
RETURNS TABLE (
  merged_message_data JSONB,
  chosen_variant_id UUID
) AS $$
DECLARE
  v_node RECORD;
  v_node_data JSONB;
  v_variants JSONB := '[]'::JSONB;
  v_elem JSONB;
  v_active JSONB := '[]'::JSONB;
  v_sorted JSONB;
  v_count INT;
  v_hash TEXT;
  v_state RECORD;
  v_idx INT;
  v_chosen JSONB;
  v_chosen_id UUID;
  v_nc JSONB;
  v_legacy_id CONSTANT UUID := 'a0000000-0000-4000-8000-000000000001'::UUID;
BEGIN
  SELECT n.id, n.node_type, n.node_data, n.campaign_id
  INTO v_node
  FROM nodes n
  WHERE n.id = p_node_id
    AND n.deleted_at IS NULL;

  IF NOT FOUND OR v_node.campaign_id IS DISTINCT FROM p_campaign_id THEN
    merged_message_data := p_base_message_data;
    chosen_variant_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_node.node_type IS DISTINCT FROM 'email' THEN
    merged_message_data := p_base_message_data;
    chosen_variant_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_node_data := COALESCE(v_node.node_data, '{}'::JSONB);

  IF v_node_data ? 'variants'
     AND jsonb_typeof(v_node_data->'variants') = 'array'
     AND jsonb_array_length(COALESCE(v_node_data->'variants', '[]'::JSONB)) > 0 THEN
    v_variants := v_node_data->'variants';
  ELSE
    v_variants := jsonb_build_array(
      jsonb_build_object(
        'id', v_legacy_id::TEXT,
        'label', 'A',
        'subject', COALESCE(v_node_data->>'subject', ''),
        'template', COALESCE(v_node_data->>'template', ''),
        'body_html', v_node_data->'body_html',
        'body_text', v_node_data->'body_text',
        'isActive', true,
        'order', 0
      )
    );
  END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY
    COALESCE(NULLIF(value->>'order', '')::INT, 999999),
    value->>'id'
  ), '[]'::JSONB)
  INTO v_active
  FROM jsonb_array_elements(v_variants) AS t(value)
  WHERE (value->>'isActive') IS DISTINCT FROM 'false';

  IF v_active IS NULL OR jsonb_array_length(v_active) = 0 THEN
    merged_message_data := p_base_message_data;
    chosen_variant_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_count := jsonb_array_length(v_active);

  SELECT string_agg(x->>'id', '|' ORDER BY ord)
  INTO v_hash
  FROM (
    SELECT value AS x, ROW_NUMBER() OVER (
      ORDER BY COALESCE(NULLIF(value->>'order', '')::INT, 999999), value->>'id'
    ) AS ord
    FROM jsonb_array_elements(v_active) AS t(value)
  ) s;

  v_hash := md5(COALESCE(v_hash, ''));

  INSERT INTO campaign_node_variant_state (campaign_id, node_id, next_index, active_set_hash, updated_at)
  VALUES (p_campaign_id, p_node_id, 0, v_hash, NOW())
  ON CONFLICT (campaign_id, node_id) DO UPDATE SET
    next_index = CASE
      WHEN campaign_node_variant_state.active_set_hash IS DISTINCT FROM EXCLUDED.active_set_hash THEN 0
      ELSE campaign_node_variant_state.next_index
    END,
    active_set_hash = EXCLUDED.active_set_hash,
    updated_at = NOW();

  SELECT * INTO v_state
  FROM campaign_node_variant_state
  WHERE campaign_id = p_campaign_id AND node_id = p_node_id
  FOR UPDATE;

  v_idx := v_state.next_index % v_count;

  v_chosen := v_active->v_idx;

  UPDATE campaign_node_variant_state
  SET next_index = v_state.next_index + 1,
      updated_at = NOW()
  WHERE campaign_id = p_campaign_id AND node_id = p_node_id;

  v_chosen_id := NULL;
  BEGIN
    v_chosen_id := (v_chosen->>'id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_chosen_id := NULL;
  END;

  v_nc := jsonb_build_object(
    'subject', COALESCE(v_chosen->>'subject', ''),
    'template', COALESCE(v_chosen->>'template', ''),
    'body_html', v_chosen->'body_html',
    'body_text', v_chosen->'body_text',
    'body', COALESCE(v_chosen->>'template', '')
  );

  IF v_node_data ? 'mailboxId' THEN
    v_nc := v_nc || jsonb_build_object('mailboxId', v_node_data->'mailboxId');
  END IF;

  merged_message_data := jsonb_build_object(
    'node_config', v_nc,
    'variant', jsonb_build_object(
      'id', COALESCE(v_chosen->>'id', v_legacy_id::TEXT),
      'label_snapshot', COALESCE(v_chosen->>'label', 'A')
    ),
    'lead_data', COALESCE(p_lead_data, p_base_message_data->'lead_data', '{}'::JSONB)
  );

  chosen_variant_id := v_chosen_id;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION merge_email_variant_into_message_job IS
  'Locks campaign_node_variant_state, picks next active variant for an email node, returns merged message_data and variant_id.';

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
      'campaign'
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

COMMENT ON FUNCTION batch_assign_jobs_to_interval IS
  'Atomically locks interval and creates message_jobs with email variant round-robin and variant_id.';

-- Variant-level stats for a campaign (sent / replied / positive / bounce) grouped by email node + variant_id.
CREATE OR REPLACE FUNCTION get_campaign_variant_stats(p_campaign_id UUID)
RETURNS TABLE (
  node_id UUID,
  variant_id UUID,
  sent_count BIGINT,
  replied_count BIGINT,
  positive_reply_count BIGINT,
  bounce_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH sent AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM message_jobs mj
    WHERE mj.campaign_id = p_campaign_id
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.node_id, mj.variant_id
  ),
  replied AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM email_threads et
    INNER JOIN message_jobs mj ON mj.id = et.message_job_id
    WHERE et.campaign_id = p_campaign_id
      AND et.has_reply = TRUE
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.node_id, mj.variant_id
  ),
  pos AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM email_threads et
    INNER JOIN message_jobs mj ON mj.id = et.message_job_id
    WHERE et.campaign_id = p_campaign_id
      AND et.has_reply = TRUE
      AND et.category = 'Interested'
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.node_id, mj.variant_id
  ),
  bnc AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'bounced'
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.node_id, mj.variant_id
  ),
  keys AS (
    SELECT s.node_id, s.variant_id FROM sent s
    UNION
    SELECT r.node_id, r.variant_id FROM replied r
    UNION
    SELECT p.node_id, p.variant_id FROM pos p
    UNION
    SELECT b.node_id, b.variant_id FROM bnc b
  )
  SELECT
    k.node_id,
    k.variant_id,
    COALESCE(s.c, 0::BIGINT),
    COALESCE(r.c, 0::BIGINT),
    COALESCE(p.c, 0::BIGINT),
    COALESCE(b.c, 0::BIGINT)
  FROM keys k
  LEFT JOIN sent s ON s.node_id = k.node_id AND s.variant_id = k.variant_id
  LEFT JOIN replied r ON r.node_id = k.node_id AND r.variant_id = k.variant_id
  LEFT JOIN pos p ON p.node_id = k.node_id AND p.variant_id = k.variant_id
  LEFT JOIN bnc b ON b.node_id = k.node_id AND b.variant_id = k.variant_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_campaign_variant_stats IS
  'Per node_id and variant_id: sent, replied, positive_reply, bounce counts for a campaign.';
