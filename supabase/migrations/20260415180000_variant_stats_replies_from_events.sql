-- Variant stats: attribute replied / positive_reply per message_job via events (same source as daily chart),
-- not email_threads.message_job_id (one thread per lead reuses the first outbound job id).

-- Persist is_positive on replied events so per-job positive counts match chart + thread category updates.
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
  VALUES (
    p_campaign_id,
    v_account_id,
    p_lead_id,
    p_enrollment_id,
    p_message_job_id,
    'replied',
    COALESCE(p_event_data, '{}'::jsonb) || jsonb_build_object('is_positive', p_is_positive)
  )
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

COMMENT ON FUNCTION record_replied_event_and_increment IS
  'Insert replied event (idempotent) with event_data.is_positive; increment campaign_stats when inserted.';

-- Backfill is_positive on historical replied rows from thread category (Interested).
UPDATE events e
SET event_data = e.event_data || jsonb_build_object('is_positive', true)
FROM email_threads et
WHERE e.event_type = 'replied'
  AND e.campaign_id = et.campaign_id
  AND e.message_job_id = et.message_job_id
  AND et.has_reply = true
  AND et.category = 'Interested'
  AND (e.event_data->>'is_positive' IS NULL);

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
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'replied'
      AND mj.variant_id IS NOT NULL
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    GROUP BY mj.node_id, mj.variant_id
  ),
  pos AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'replied'
      AND COALESCE((e.event_data->>'is_positive')::boolean, false) = true
      AND mj.variant_id IS NOT NULL
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
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
  'Per node_id and variant_id: sent from message_jobs; replied and positive_reply from events (per outbound job); bounce from events.';
