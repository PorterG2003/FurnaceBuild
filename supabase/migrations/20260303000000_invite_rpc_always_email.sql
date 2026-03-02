-- Update invite_user_to_account: remove "existing auth user → add directly" branch.
-- All invitees now go through the invitation email flow (consistent UX).
-- Only already_member short-circuits.

CREATE OR REPLACE FUNCTION invite_user_to_account(
  p_account_id UUID,
  p_email      TEXT,
  p_invited_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_clean_email  TEXT := lower(trim(p_email));
  v_target_uid   UUID;
  v_now          TIMESTAMPTZ := now();
  v_invitation_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_users
    WHERE account_id = p_account_id
      AND user_id = v_uid
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to invite users to this account';
  END IF;

  -- Check if invitee is already a member (via auth.users → account_users)
  SELECT au.user_id INTO v_target_uid
  FROM auth.users u
  JOIN account_users au ON au.user_id = u.id AND au.account_id = p_account_id
  WHERE u.email = v_clean_email
  LIMIT 1;

  IF v_target_uid IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;

  -- Check for existing pending invitation
  SELECT id INTO v_invitation_id
  FROM invitations
  WHERE account_id = p_account_id
    AND lower(email) = v_clean_email
    AND status = 'pending'
  LIMIT 1;

  IF v_invitation_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'pending_invite', 'invitation_id', v_invitation_id);
  END IF;

  -- Create new pending invitation (works for both new and existing users)
  INSERT INTO invitations (account_id, email, invited_by_user_id, status, created_at, updated_at)
  VALUES (p_account_id, v_clean_email, p_invited_by, 'pending', v_now, v_now)
  ON CONFLICT (account_id, email) WHERE status = 'pending'
    DO UPDATE SET updated_at = v_now
  RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object('status', 'invited', 'invitation_id', v_invitation_id);
END;
$$;
