-- ============================================
-- Migration: Add account_id to RPC inserts (batch_assign, record_sent/replied/bounced_event)
-- ============================================
-- Ensures all inserts into message_jobs, events, campaign_stats include account_id for RLS.

-- 1. batch_assign_jobs_to_interval: include account_id in message_jobs INSERT
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
  -- Get campaign interval duration and account_id
  SELECT c.sending_interval_seconds, c.account_id
  INTO v_interval_duration_seconds, v_account_id
  FROM campaigns c
  WHERE c.id = p_campaign_id;

  IF NOT FOUND OR v_account_id IS NULL THEN
    RETURN;
  END IF;

  -- Step 1: Atomically lock the FIRST available/scheduled interval
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

-- 2. record_sent_event_and_increment: include account_id in events and campaign_stats
CREATE OR REPLACE FUNCTION record_sent_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, v_account_id, p_lead_id, p_enrollment_id, p_message_job_id, 'sent', COALESCE(p_event_data, '{}'));

  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, v_account_id, 1, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    sent_count = campaign_stats.sent_count + 1,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 3. record_replied_event_and_increment: include account_id
CREATE OR REPLACE FUNCTION record_replied_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_event_data JSONB DEFAULT '{}',
  p_is_positive BOOLEAN DEFAULT false
)
RETURNS BOOLEAN AS $$
DECLARE
  v_account_id UUID;
  v_rows_inserted INT;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, v_account_id, p_lead_id, p_enrollment_id, p_message_job_id, 'replied', COALESCE(p_event_data, '{}'))
  ON CONFLICT (campaign_id, message_job_id, event_type) WHERE (event_type = 'replied') DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted > 0 THEN
    INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
    VALUES (p_campaign_id, v_account_id, 0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0, NOW())
    ON CONFLICT (campaign_id) DO UPDATE SET
      replied_count = campaign_stats.replied_count + 1,
      positive_reply_count = campaign_stats.positive_reply_count + CASE WHEN p_is_positive THEN 1 ELSE 0 END,
      updated_at = NOW();
  END IF;

  RETURN v_rows_inserted > 0;
END;
$$ LANGUAGE plpgsql;

-- 4. record_bounced_event_and_increment: include account_id
CREATE OR REPLACE FUNCTION record_bounced_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_mailbox_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, mailbox_id, event_type, event_data)
  VALUES (p_campaign_id, v_account_id, p_lead_id, p_enrollment_id, p_message_job_id, p_mailbox_id, 'bounced', COALESCE(p_event_data, '{}'));

  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at, updated_at)
  VALUES (p_campaign_id, v_account_id, 0, 0, 0, 1, NOW(), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    bounce_count = campaign_stats.bounce_count + 1,
    last_bounce_at = GREATEST(COALESCE(campaign_stats.last_bounce_at, TIMESTAMPTZ '1970-01-01'), NOW()),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
