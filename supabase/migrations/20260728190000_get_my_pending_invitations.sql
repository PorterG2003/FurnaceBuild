-- Recovery path for users who confirmed their email but never landed on
-- /accept-invitation/{id}, so no account_users row was ever created. They end up
-- stranded on /no-workspace with no way back: /auth redirects signed-in users to /,
-- which re-enters (main) and bounces to /no-workspace again.
--
-- The client can already read its own invitations (invitations_select_invitee), but
-- accounts_select_member hides the account row from non-members, so the account name
-- is unavailable over a plain join. SECURITY DEFINER so we can name the workspace the
-- user is being invited to; scoped strictly to the caller's own email.

CREATE OR REPLACE FUNCTION public.get_my_pending_invitations()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_out   JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'invitation_id', t.id,
               'account_id',    t.account_id,
               'account_name',  t.account_name,
               'inviter_name',  t.inviter_name,
               'created_at',    t.created_at
             )
             ORDER BY t.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO v_out
  FROM (
    SELECT
      i.id,
      i.account_id,
      a.name AS account_name,
      COALESCE(NULLIF(u.name, ''), u.email) AS inviter_name,
      i.created_at
    FROM invitations i
    JOIN accounts a ON a.id = i.account_id
    -- LEFT JOIN: a deleted inviter must not hide an otherwise valid invitation.
    LEFT JOIN users u ON u.id = i.invited_by_user_id
    WHERE lower(i.email) = v_email
      AND i.status = 'pending'
      AND (i.expires_at IS NULL OR i.expires_at > now())
      AND NOT EXISTS (
        SELECT 1
        FROM account_users m
        WHERE m.account_id = i.account_id
          AND m.user_id = v_uid
      )
  ) t;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_invitations() TO service_role;
