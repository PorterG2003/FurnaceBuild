-- Per-day stats for imported campaigns (e.g. Smartlead). One row per (campaign_id, date).
-- Native campaigns use events for per-day stats; this table is for imported data only.
CREATE TABLE IF NOT EXISTS imported_campaign_stats_by_day (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  positive_reply_count integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_imported_campaign_stats_by_day_campaign_date
  ON imported_campaign_stats_by_day (campaign_id, date);

COMMENT ON TABLE imported_campaign_stats_by_day IS 'Per-day sent/replied/bounce counts for campaigns imported from external sources (e.g. Smartlead). Used for charts instead of synthetic events.';

ALTER TABLE imported_campaign_stats_by_day ENABLE ROW LEVEL SECURITY;

CREATE POLICY "imported_campaign_stats_by_day_select"
  ON imported_campaign_stats_by_day FOR SELECT
  USING (
    campaign_id IN (
      SELECT id FROM campaigns
      WHERE account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "imported_campaign_stats_by_day_insert"
  ON imported_campaign_stats_by_day FOR INSERT
  WITH CHECK (
    campaign_id IN (
      SELECT id FROM campaigns
      WHERE account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "imported_campaign_stats_by_day_update"
  ON imported_campaign_stats_by_day FOR UPDATE
  USING (
    campaign_id IN (
      SELECT id FROM campaigns
      WHERE account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    )
  );
