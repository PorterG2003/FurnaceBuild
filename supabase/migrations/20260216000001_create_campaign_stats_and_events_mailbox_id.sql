-- ============================================
-- Migration: Create campaign_stats table + optional events.mailbox_id
-- ============================================
-- Cached aggregates for heavy campaign stat reads (sent, replied, positive reply, bounce).
-- One row per campaign; updated by send worker and inbox checker.

CREATE TABLE IF NOT EXISTS campaign_stats (
  campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  sent_count INT NOT NULL DEFAULT 0,
  replied_count INT NOT NULL DEFAULT 0,
  positive_reply_count INT NOT NULL DEFAULT 0,
  bounce_count INT NOT NULL DEFAULT 0,
  last_bounce_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE campaign_stats IS 'Cached campaign stats for heavy reads. Updated by send worker and inbox checker.';
COMMENT ON COLUMN campaign_stats.last_bounce_at IS 'Last time a bounce was recorded for this campaign.';

-- Trigger: create campaign_stats row when a new campaign is created
CREATE OR REPLACE FUNCTION create_campaign_stats_on_campaign_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (NEW.id, 0, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_campaign_insert_create_stats ON campaigns;
CREATE TRIGGER after_campaign_insert_create_stats
  AFTER INSERT ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION create_campaign_stats_on_campaign_insert();

-- Optional: mailbox_id on events for bounce events (bounces per mailbox / high-risk logic)
ALTER TABLE events ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_mailbox_type ON events(mailbox_id, event_type) WHERE event_type = 'bounced';

COMMENT ON COLUMN events.mailbox_id IS 'Mailbox that sent the message (for bounce events). Enables bounces per mailbox without joining message_jobs.';

-- RPC: atomically increment sent_count for a campaign (used by send worker)
CREATE OR REPLACE FUNCTION increment_campaign_stats_sent(p_campaign_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, 1, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    sent_count = campaign_stats.sent_count + 1,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_campaign_stats_sent IS 'Increment sent_count for a campaign. Called by send worker after marking message_job sent.';

-- RPC: atomically increment bounce_count and set last_bounce_at (used by inbox checker)
CREATE OR REPLACE FUNCTION increment_campaign_stats_bounce(p_campaign_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at, updated_at)
  VALUES (p_campaign_id, 0, 0, 0, 1, NOW(), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    bounce_count = campaign_stats.bounce_count + 1,
    last_bounce_at = GREATEST(COALESCE(campaign_stats.last_bounce_at, TIMESTAMPTZ '1970-01-01'), NOW()),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_campaign_stats_bounce IS 'Increment bounce_count and set last_bounce_at. Called by inbox checker when bounce is detected.';

-- RPC: atomically increment replied_count and optionally positive_reply_count (used by inbox checker)
CREATE OR REPLACE FUNCTION increment_campaign_stats_replied(p_campaign_id UUID, p_is_positive BOOLEAN DEFAULT false)
RETURNS void AS $$
BEGIN
  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, 0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    replied_count = campaign_stats.replied_count + 1,
    positive_reply_count = campaign_stats.positive_reply_count + CASE WHEN p_is_positive THEN 1 ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_campaign_stats_replied IS 'Increment replied_count and optionally positive_reply_count. Called by inbox checker when reply is processed.';
