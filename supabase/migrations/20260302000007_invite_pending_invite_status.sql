-- When re-inviting an email that already has a pending invitation, return
-- status 'pending_invite' so the client can show "They already have a pending
-- invite" and they appear in the pending invites list (no duplicate email).

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

  -- Caller must be owner or admin of the account
  IF NOT EXISTS (
    SELECT 1 FROM account_users
    WHERE account_id = p_account_id
      AND user_id = v_uid
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to invite users to this account';
  END IF;

  -- Check if the email belongs to an existing auth user
  SELECT id INTO v_target_uid
  FROM auth.users
  WHERE email = v_clean_email
  LIMIT 1;

  IF v_target_uid IS NOT NULL THEN
    -- User has a Supabase auth account. Ensure public.users row exists
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES (v_target_uid, v_clean_email, '', v_now, v_now)
    ON CONFLICT (id) DO NOTHING;

    -- Add to account (skip if already a member)
    INSERT INTO account_users (account_id, user_id, is_owner, role, created_at, updated_at)
    VALUES (p_account_id, v_target_uid, false, 'member', v_now, v_now)
    ON CONFLICT (account_id, user_id) DO NOTHING;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'already_member');
    END IF;

    RETURN jsonb_build_object('status', 'added');
  END IF;

  -- No auth account — check for existing pending invitation first
  SELECT id INTO v_invitation_id
  FROM invitations
  WHERE account_id = p_account_id
    AND lower(email) = v_clean_email
    AND status = 'pending'
  LIMIT 1;

  IF v_invitation_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'pending_invite', 'invitation_id', v_invitation_id);
  END IF;

  -- Create new pending invitation
  INSERT INTO invitations (account_id, email, invited_by_user_id, status, created_at, updated_at)
  VALUES (p_account_id, v_clean_email, p_invited_by, 'pending', v_now, v_now)
  ON CONFLICT (account_id, email) WHERE status = 'pending'
    DO UPDATE SET updated_at = v_now
  RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object('status', 'invited', 'invitation_id', v_invitation_id);
END;
$$;
