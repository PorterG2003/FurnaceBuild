-- Default new campaigns to Central business hours (9–5 Mon–Fri) with a
-- 24-minute send interval (~20 emails per mailbox per scheduled day).
-- Does not backfill existing rows. schedule null still means 24/7 when set explicitly.

ALTER TABLE campaigns
  ALTER COLUMN schedule SET DEFAULT jsonb_build_object(
    'timezone', 'America/Chicago',
    'start_hour', 9,
    'start_minute', 0,
    'end_hour', 17,
    'end_minute', 0,
    'days_of_week', jsonb_build_array(1, 2, 3, 4, 5)
  );

ALTER TABLE campaigns
  ALTER COLUMN sending_interval_seconds SET DEFAULT 1440;

COMMENT ON COLUMN campaigns.schedule IS
  'Campaign schedule JSONB: {timezone, start_hour, end_hour, days_of_week[, start_minute, end_minute]}. null = 24/7. New campaigns default to Central 9–5 Mon–Fri.';

COMMENT ON COLUMN campaigns.sending_interval_seconds IS
  'Interval between sends per mailbox (seconds). Default: 1440 (24 minutes; ~20 emails per mailbox per day on the default 9–5 window).';
