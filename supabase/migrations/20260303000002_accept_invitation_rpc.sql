-- RPC: accept_invitation
-- Authenticated only. Validates email match, marks invitation accepted,
-- adds user to account_users, and returns account_id for client switching.

CREATE OR REPLACE FUNCTION accept_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_user_email  TEXT;
  v_inv         RECORD;
  v_now         TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(email) INTO v_user_email
  FROM auth.users
  WHERE id = v_uid;

  SELECT i.id, i.account_id, lower(i.email) AS email, i.status, i.expires_at
  INTO v_inv
  FROM invitations i
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < v_now THEN
    UPDATE invitations SET status = 'expired' WHERE id = p_invitation_id AND status = 'pending';
    RETURN jsonb_build_object('status', 'expired', 'account_id', v_inv.account_id);
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'already_member', 'account_id', v_inv.account_id);
  END IF;

  IF v_inv.status != 'pending' THEN
    RETURN jsonb_build_object('status', v_inv.status, 'account_id', v_inv.account_id);
  END IF;

  IF v_user_email != v_inv.email THEN
    RETURN jsonb_build_object('status', 'email_mismatch', 'account_id', v_inv.account_id);
  END IF;

  -- Ensure public.users row exists (handle_new_user trigger usually creates it)
  INSERT INTO users (id, email, name, created_at, updated_at)
  VALUES (v_uid, v_user_email, '', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- Add to account
  INSERT INTO account_users (account_id, user_id, is_owner, role, created_at, updated_at)
  VALUES (v_inv.account_id, v_uid, false, 'member', v_now, v_now)
  ON CONFLICT (account_id, user_id) DO NOTHING;

  IF NOT FOUND THEN
    UPDATE invitations SET status = 'accepted' WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'already_member', 'account_id', v_inv.account_id);
  END IF;

  UPDATE invitations SET status = 'accepted' WHERE id = p_invitation_id;

  RETURN jsonb_build_object('status', 'accepted', 'account_id', v_inv.account_id);
END;
$$;
