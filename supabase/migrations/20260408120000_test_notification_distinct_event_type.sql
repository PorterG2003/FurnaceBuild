-- Test helper notifications use their own event_type so the app can show a distinct icon
-- (real inbox email remains email.received).
CREATE OR REPLACE FUNCTION public.create_test_notification(
  p_account_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_title text := coalesce(
    nullif(trim(p_payload ->> 'title'), ''),
    'Test: New email received'
  );
  v_body text := coalesce(
    nullif(trim(p_payload ->> 'body'), ''),
    'This is a test in-app notification (test.notification).'
  );
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
    'test.notification',
    '{"source":"web_test"}'::jsonb,
    'web-test-' || gen_random_uuid()::text
  )
  RETURNING id INTO v_event_id;

  INSERT INTO notifications (user_id, account_id, event_id, title, body, status)
  VALUES (v_user_id, p_account_id, v_event_id, v_title, v_body, 'unread');

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.create_test_notification(uuid, jsonb) IS
  'Test helper: creates test.notification event + in-app notification for auth.uid(); optional keys in p_payload: title, body.';

NOTIFY pgrst, 'reload schema';
