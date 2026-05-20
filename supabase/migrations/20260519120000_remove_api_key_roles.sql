-- Remove API key admin/member roles; all keys have unified full Client API access.

DROP FUNCTION IF EXISTS create_account_api_key(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS list_account_api_keys(uuid);

ALTER TABLE account_api_keys
  DROP CONSTRAINT IF EXISTS account_api_keys_role_check;

ALTER TABLE account_api_keys
  DROP COLUMN IF EXISTS role;

CREATE OR REPLACE FUNCTION create_account_api_key(
  p_account_id uuid,
  p_name text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  name text,
  secret text,
  secret_prefix text,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
  v_secret text;
  v_prefix text;
  v_id uuid;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'API key name is required';
  END IF;

  SELECT * INTO v_actor
  FROM private_assert_account_admin(p_account_id);

  IF (
    SELECT count(*)
    FROM account_api_keys k
    WHERE k.account_id = p_account_id
      AND k.revoked_at IS NULL
  ) >= 10 THEN
    RAISE EXCEPTION 'API key limit reached (10 active keys max)';
  END IF;

  v_secret := 'f_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := left(v_secret, 12);

  INSERT INTO account_api_keys (
    account_id,
    created_by_user_id,
    name,
    key_hash,
    secret_prefix,
    expires_at
  ) VALUES (
    p_account_id,
    v_actor.user_id,
    btrim(p_name),
    encode(extensions.digest(convert_to(v_secret, 'utf8'), 'sha256'::text), 'hex'),
    v_prefix,
    p_expires_at
  )
  RETURNING account_api_keys.id INTO v_id;

  RETURN QUERY
  SELECT
    k.id,
    k.account_id,
    k.name,
    v_secret AS secret,
    k.secret_prefix,
    k.expires_at,
    k.last_used_at,
    k.revoked_at,
    k.created_at,
    k.updated_at
  FROM account_api_keys k
  WHERE k.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION list_account_api_keys(p_account_id uuid)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  name text,
  secret_prefix text,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM private_assert_account_admin(p_account_id);

  RETURN QUERY
  SELECT
    k.id,
    k.account_id,
    k.name,
    k.secret_prefix,
    k.expires_at,
    k.last_used_at,
    k.revoked_at,
    k.created_at,
    k.updated_at
  FROM account_api_keys k
  WHERE k.account_id = p_account_id
  ORDER BY k.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION create_account_api_key(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_account_api_key(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION create_account_api_key(uuid, text, timestamptz) TO service_role;
