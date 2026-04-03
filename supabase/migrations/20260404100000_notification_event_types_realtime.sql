-- Relax event_type CHECK constraints so new notification kinds can be added without schema churn.
-- Validate allowed values in application code and Lambda processors.

ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS notification_events_event_type_check;
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_event_type_check;

COMMENT ON COLUMN notification_events.event_type IS 'Product event id (e.g. email.received). Extend in app/Lambda; no DB enum.';
COMMENT ON COLUMN notification_preferences.event_type IS 'Matches notification_events.event_type for prefs row.';

-- Enable Realtime for in-app notification toasts (postgres_changes on client).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;
