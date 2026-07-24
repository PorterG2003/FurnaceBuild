-- User-scoped MCP OAuth sessions (multi-account grants).
-- Step 1 of secret hygiene: stop relying on plaintext api_key_secret in the new path.
-- A follow-up migration drops those columns after the new code is live.

CREATE TABLE IF NOT EXISTS mcp_oauth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text,
  allowed_account_ids uuid[] NOT NULL DEFAULT '{}',
  -- Reserved/unenforced: always '{furnace.mcp}' (full access) for now.
  scopes text[] NOT NULL DEFAULT '{furnace.mcp}',
  token_hash text UNIQUE NOT NULL,
  refresh_token_hash text UNIQUE,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_sessions_user_idx
  ON mcp_oauth_sessions (user_id);

CREATE INDEX IF NOT EXISTS mcp_oauth_sessions_token_hash_idx
  ON mcp_oauth_sessions (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_sessions_refresh_hash_idx
  ON mcp_oauth_sessions (refresh_token_hash)
  WHERE revoked_at IS NULL AND refresh_token_hash IS NOT NULL;

ALTER TABLE mcp_oauth_sessions ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service-role-only (MCP + Client API Lambdas).
-- Do not add a permissive policy later; end-user clients must never read this table directly.

-- Auth codes carry a user grant instead of (or in addition to) a pinned API key.
ALTER TABLE mcp_oauth_auth_codes
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS allowed_account_ids uuid[] NOT NULL DEFAULT '{}';

-- Legacy columns become nullable so new codes don't need an API key / single account.
ALTER TABLE mcp_oauth_auth_codes
  ALTER COLUMN account_id DROP NOT NULL,
  ALTER COLUMN api_key_secret DROP NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_auth_codes_user_idx
  ON mcp_oauth_auth_codes (user_id);

-- Cutover: purge legacy account-pinned tokens (they hold plaintext api_key_secret).
-- Existing MCP OAuth connections must reconnect once.
DELETE FROM mcp_oauth_access_tokens;
