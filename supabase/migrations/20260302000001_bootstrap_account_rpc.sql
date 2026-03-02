-- RPC: bootstrap_account
-- Called from the client when a new user has no account memberships.
-- Creates a new account and adds the calling user as owner, bypassing RLS.
CREATE OR REPLACE FUNCTION bootstrap_account(p_account_name TEXT)
RETURNS UUID AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM account_users WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'User already belongs to an account';
  END IF;

  INSERT INTO accounts (name, created_at, updated_at)
  VALUES (p_account_name, v_now, v_now)
  RETURNING id INTO v_account_id;

  INSERT INTO account_users (account_id, user_id, is_owner, role, created_at, updated_at)
  VALUES (v_account_id, v_uid, true, 'owner', v_now, v_now);

  RETURN v_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
