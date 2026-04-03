-- Let authenticated users read notification_events rows that are linked to their own
-- in-app notifications (needed to show event_type in the UI via PostgREST embed).
CREATE POLICY notification_events_select_via_notifications ON notification_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM notifications n
      WHERE n.event_id = notification_events.id
        AND n.user_id = auth.uid()
    )
  );
