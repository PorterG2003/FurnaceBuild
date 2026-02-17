-- ============================================
-- Migration: Backfill campaign_stats from existing data
-- ============================================
-- Ensures every campaign has a campaign_stats row and populates counts from
-- message_jobs, email_threads, and events (one-time backfill).

-- Ensure a row exists for every campaign (trigger only runs on new campaigns)
INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at, updated_at)
SELECT id, 0, 0, 0, 0, NULL, NOW()
FROM campaigns
ON CONFLICT (campaign_id) DO NOTHING;

-- Backfill counts from source tables
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
  updated_at = NOW();
