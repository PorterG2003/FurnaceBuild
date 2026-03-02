-- RPC: get_invitation_info
-- Public (anon + authenticated) — no auth required.
-- Returns invitation details so the accept-invitation page can render
-- the invitation card before the user signs in.

CREATE OR REPLACE FUNCTION get_invitation_info(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
BEGIN
  SELECT
    i.id,
    i.status,
    i.email       AS invitee_email,
    i.expires_at,
    a.name        AS account_name,
    u.name        AS inviter_name,
    u.email       AS inviter_email
  INTO v_inv
  FROM invitations i
  JOIN accounts a ON a.id = i.account_id
  JOIN users u ON u.id = i.invited_by_user_id
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'accepted');
  END IF;

  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v_inv.status != 'pending' THEN
    RETURN jsonb_build_object('status', v_inv.status);
  END IF;

  RETURN jsonb_build_object(
    'status',        'pending',
    'account_name',  v_inv.account_name,
    'inviter_name',  COALESCE(NULLIF(v_inv.inviter_name, ''), v_inv.inviter_email),
    'invitee_email', v_inv.invitee_email,
    'expires_at',    v_inv.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_invitation_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_invitation_info(UUID) TO authenticated;
