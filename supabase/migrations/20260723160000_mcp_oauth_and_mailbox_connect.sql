-- MCP OAuth + mailbox connect sessions for Client API / hosted MCP.

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id text PRIMARY KEY,
  client_secret_hash text,
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_auth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_secret text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_auth_codes_account_idx
  ON mcp_oauth_auth_codes (account_id);

CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_secret text NOT NULL,
  client_id text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_access_tokens_account_idx
  ON mcp_oauth_access_tokens (account_id);

CREATE TABLE IF NOT EXISTS mailbox_connect_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  mailbox_id uuid,
  error_message text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailbox_connect_sessions_account_idx
  ON mailbox_connect_sessions (account_id, created_at DESC);

ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_connect_sessions ENABLE ROW LEVEL SECURITY;
