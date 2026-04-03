-- Dev/test: insert notification_events + notifications for the current user without Lambda.
-- Guarded by account membership; dedupe_key prefix identifies synthetic rows.

CREATE OR REPLACE FUNCTION public.create_test_notification(
  p_account_id uuid,
  p_title text DEFAULT 'Test: New email received',
  p_body text DEFAULT 'This is a test in-app notification (email.received).'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM account_users
    WHERE user_id = v_user_id
      AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this account';
  END IF;

  INSERT INTO notification_events (account_id, event_type, payload, dedupe_key)
  VALUES (
    p_account_id,
    'email.received',
    '{"source":"web_test"}'::jsonb,
    'web-test-' || gen_random_uuid()::text
  )
  RETURNING id INTO v_event_id;

  INSERT INTO notifications (user_id, account_id, event_id, title, body, status)
  VALUES (v_user_id, p_account_id, v_event_id, p_title, p_body, 'unread');

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_test_notification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_test_notification(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_test_notification(uuid, text, text) IS
  'Test helper: creates email.received event + in-app notification for auth.uid(); use from /test/notifications only in practice.';
