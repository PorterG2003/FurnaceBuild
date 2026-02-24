-- When mailbox throttle columns (min_gap_seconds, daily_limit, hourly_limit) are updated,
-- propagate to today's mailbox_throttles row if it exists so the new limits take effect same-day.

CREATE OR REPLACE FUNCTION sync_mailbox_throttle_limits_from_mailbox()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.min_gap_seconds IS DISTINCT FROM NEW.min_gap_seconds)
     OR (OLD.daily_limit IS DISTINCT FROM NEW.daily_limit)
     OR (OLD.hourly_limit IS DISTINCT FROM NEW.hourly_limit) THEN
    UPDATE mailbox_throttles
    SET
      min_gap_seconds = COALESCE(NEW.min_gap_seconds, 180),
      daily_limit = COALESCE(NEW.daily_limit, 50),
      hourly_limit = COALESCE(NEW.hourly_limit, 10),
      updated_at = NOW()
    WHERE mailbox_id = NEW.id
      AND date = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sync_mailbox_throttle_limits_from_mailbox() IS
  'Trigger function: when mailboxes throttle columns change, update today''s mailbox_throttles row so new limits apply same-day.';

DROP TRIGGER IF EXISTS sync_mailbox_throttle_on_mailbox_update ON mailboxes;
CREATE TRIGGER sync_mailbox_throttle_on_mailbox_update
  AFTER UPDATE ON mailboxes
  FOR EACH ROW
  EXECUTE FUNCTION sync_mailbox_throttle_limits_from_mailbox();
