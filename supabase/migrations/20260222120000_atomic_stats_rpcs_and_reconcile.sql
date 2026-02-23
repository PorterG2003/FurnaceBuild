-- ============================================
-- Migration: Atomic event+stats RPCs, unique replied index, reconcile_campaign_stats
-- ============================================
-- Combines event insert + campaign_stats increment in a single transaction to prevent drift.
-- Adds unique constraint on replied events per (campaign_id, message_job_id).
-- Adds reconcile_campaign_stats(p_campaign_id) for periodic or manual reconciliation.

-- Unique partial index: at most one 'replied' event per (campaign_id, message_job_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_replied
  ON events (campaign_id, message_job_id, event_type)
  WHERE event_type = 'replied';

-- RPC: insert sent event + increment campaign_stats.sent_count (atomic)
CREATE OR REPLACE FUNCTION record_sent_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  INSERT INTO events (campaign_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, p_lead_id, p_enrollment_id, p_message_job_id, 'sent', COALESCE(p_event_data, '{}'));

  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, 1, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    sent_count = campaign_stats.sent_count + 1,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_sent_event_and_increment IS 'Insert sent event and increment campaign_stats.sent_count in one transaction. Used by send worker.';

-- RPC: insert replied event (if not exists) + increment campaign_stats.replied_count (atomic, idempotent)
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
  v_rows_inserted INT;
BEGIN
  INSERT INTO events (campaign_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, p_lead_id, p_enrollment_id, p_message_job_id, 'replied', COALESCE(p_event_data, '{}'))
  ON CONFLICT (campaign_id, message_job_id, event_type) WHERE (event_type = 'replied') DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted > 0 THEN
    INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
    VALUES (p_campaign_id, 0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0, NOW())
    ON CONFLICT (campaign_id) DO UPDATE SET
      replied_count = campaign_stats.replied_count + 1,
      positive_reply_count = campaign_stats.positive_reply_count + CASE WHEN p_is_positive THEN 1 ELSE 0 END,
      updated_at = NOW();
  END IF;

  RETURN v_rows_inserted > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_replied_event_and_increment IS 'Insert replied event (idempotent via unique index) and increment campaign_stats. Only increments when event was actually inserted. Used by inbox checker.';

-- RPC: insert bounced event + increment campaign_stats.bounce_count + set last_bounce_at (atomic)
CREATE OR REPLACE FUNCTION record_bounced_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_mailbox_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  INSERT INTO events (campaign_id, lead_id, enrollment_id, message_job_id, mailbox_id, event_type, event_data)
  VALUES (p_campaign_id, p_lead_id, p_enrollment_id, p_message_job_id, p_mailbox_id, 'bounced', COALESCE(p_event_data, '{}'));

  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at, updated_at)
  VALUES (p_campaign_id, 0, 0, 0, 1, NOW(), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    bounce_count = campaign_stats.bounce_count + 1,
    last_bounce_at = GREATEST(COALESCE(campaign_stats.last_bounce_at, TIMESTAMPTZ '1970-01-01'), NOW()),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_bounced_event_and_increment IS 'Insert bounced event and increment campaign_stats.bounce_count in one transaction. Used by inbox checker.';

-- RPC: recompute campaign_stats from source tables (message_jobs, email_threads, events). Optional single campaign.
CREATE OR REPLACE FUNCTION reconcile_campaign_stats(p_campaign_id UUID DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE campaign_stats cs
  SET
    sent_count = COALESCE((
      SELECT COUNT(*)::int
      FROM message_jobs mj
      WHERE mj.campaign_id = cs.campaign_id
        AND mj.status = 'sent'
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    ), 0),
    replied_count = COALESCE((
      SELECT COUNT(*)::int
      FROM email_threads et
      WHERE et.campaign_id = cs.campaign_id
        AND et.has_reply = true
    ), 0),
    positive_reply_count = COALESCE((
      SELECT COUNT(*)::int
      FROM email_threads et
      WHERE et.campaign_id = cs.campaign_id
        AND et.has_reply = true
        AND et.category = 'Interested'
    ), 0),
    bounce_count = COALESCE((
      SELECT COUNT(*)::int
      FROM events e
      WHERE e.campaign_id = cs.campaign_id
        AND e.event_type = 'bounced'
    ), 0),
    last_bounce_at = (
      SELECT MAX(e.created_at)
      FROM events e
      WHERE e.campaign_id = cs.campaign_id
        AND e.event_type = 'bounced'
    ),
    updated_at = NOW()
  WHERE (p_campaign_id IS NULL OR cs.campaign_id = p_campaign_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reconcile_campaign_stats IS 'Recompute campaign_stats from message_jobs, email_threads, and events. Pass NULL to reconcile all campaigns, or a campaign_id for one. Returns number of rows updated.';