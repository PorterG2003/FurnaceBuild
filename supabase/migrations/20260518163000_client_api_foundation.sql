-- ============================================
-- Migration: client API foundation
-- ============================================
-- Adds:
-- - account_api_keys
-- - api_idempotency_keys
-- - api_rate_limit_buckets
-- - webhook config columns on accounts/campaigns
-- - webhook_events / webhook_deliveries
-- - api_import_jobs
-- - JWT RPCs for API key CRUD

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_signing_secret text,
  ADD COLUMN IF NOT EXISTS webhook_enabled_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_url_verified_at timestamptz;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS webhook_url_override text,
  ADD COLUMN IF NOT EXISTS webhook_signing_secret_override text,
  ADD COLUMN IF NOT EXISTS webhook_enabled_events_override jsonb,
  ADD COLUMN IF NOT EXISTS webhook_url_override_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS account_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  role text NOT NULL,
  key_hash text NOT NULL,
  secret_prefix text NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_api_keys_role_check CHECK (role IN ('admin', 'member'))
);

CREATE UNIQUE INDEX IF NOT EXISTS account_api_keys_hash_unique
  ON account_api_keys (key_hash);

CREATE UNIQUE INDEX IF NOT EXISTS account_api_keys_active_name_unique
  ON account_api_keys (account_id, lower(name))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS account_api_keys_account_idx
  ON account_api_keys (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  route text NOT NULL,
  body_hash text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_idempotency_keys_unique
  ON api_idempotency_keys (account_id, idempotency_key, route, body_hash);

CREATE INDEX IF NOT EXISTS api_idempotency_keys_created_idx
  ON api_idempotency_keys (created_at);

CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_rate_limit_buckets_request_count_check CHECK (request_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_rate_limit_buckets_window_unique
  ON api_rate_limit_buckets (account_id, window_start);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_dedupe_unique
  ON webhook_events (account_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_account_idx
  ON webhook_events (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS webhook_events_campaign_idx
  ON webhook_events (campaign_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  request_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status integer,
  response_body text,
  error text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('pending', 'sending', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_event_idx
  ON webhook_deliveries (webhook_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS webhook_deliveries_account_idx
  ON webhook_deliveries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by_api_key_id uuid REFERENCES account_api_keys(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_import_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT api_import_jobs_progress_check CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX IF NOT EXISTS api_import_jobs_account_idx
  ON api_import_jobs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS api_import_jobs_campaign_idx
  ON api_import_jobs (campaign_id, created_at DESC);

ALTER TABLE account_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_import_jobs ENABLE ROW LEVEL SECURITY;
-- Internal/service-role tables; access is via service role or SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION private_assert_account_admin(p_account_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT au.user_id, au.role::text
  FROM account_users au
  WHERE au.account_id = p_account_id
    AND au.user_id = v_uid
    AND au.role IN ('owner', 'admin');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account admin access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION create_account_api_key(
  p_account_id uuid,
  p_name text,
  p_role text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  name text,
  role text,
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
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'API key role must be admin or member';
  END IF;

  SELECT * INTO v_actor
  FROM private_assert_account_admin(p_account_id);

  IF (
    SELECT count(*)
    FROM account_api_keys
    WHERE account_id = p_account_id
      AND revoked_at IS NULL
  ) >= 10 THEN
    RAISE EXCEPTION 'API key limit reached (10 active keys max)';
  END IF;

  v_secret := 'f_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := left(v_secret, 12);

  INSERT INTO account_api_keys (
    account_id,
    created_by_user_id,
    name,
    role,
    key_hash,
    secret_prefix,
    expires_at
  ) VALUES (
    p_account_id,
    v_actor.user_id,
    btrim(p_name),
    p_role,
    encode(digest(v_secret, 'sha256'), 'hex'),
    v_prefix,
    p_expires_at
  )
  RETURNING account_api_keys.id INTO v_id;

  RETURN QUERY
  SELECT
    k.id,
    k.account_id,
    k.name,
    k.role,
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
  role text,
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
    k.role,
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

CREATE OR REPLACE FUNCTION rename_account_api_key(
  p_account_id uuid,
  p_key_id uuid,
  p_name text
)
RETURNS account_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row account_api_keys%ROWTYPE;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'API key name is required';
  END IF;

  PERFORM 1 FROM private_assert_account_admin(p_account_id);

  UPDATE account_api_keys
  SET
    name = btrim(p_name),
    updated_at = now()
  WHERE id = p_key_id
    AND account_id = p_account_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'API key not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_account_api_key(
  p_account_id uuid,
  p_key_id uuid
)
RETURNS account_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row account_api_keys%ROWTYPE;
BEGIN
  PERFORM 1 FROM private_assert_account_admin(p_account_id);

  UPDATE account_api_keys
  SET
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
  WHERE id = p_key_id
    AND account_id = p_account_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'API key not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION private_assert_account_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_account_api_key(uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_account_api_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rename_account_api_key(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_account_api_key(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_account_api_key(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION list_account_api_keys(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rename_account_api_key(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_account_api_key(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION create_account_api_key(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION list_account_api_keys(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION rename_account_api_key(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_account_api_key(uuid, uuid) TO service_role;
