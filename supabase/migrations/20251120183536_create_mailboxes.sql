-- ============================================
-- Migration: Create Mailboxes Table
-- ============================================
-- Stores SMTP and IMAP credentials for user email accounts
-- Credentials are encrypted at rest (handled by application layer or Supabase Vault)

CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT,
  provider TEXT NOT NULL DEFAULT 'custom', -- 'gmail', 'outlook', 'custom'
  
  -- SMTP Configuration (for sending emails)
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_username TEXT NOT NULL,
  smtp_password TEXT NOT NULL, -- Encrypted password
  smtp_use_tls BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_use_ssl BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- IMAP Configuration (for reading emails)
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_username TEXT NOT NULL,
  imap_password TEXT NOT NULL, -- Encrypted password
  imap_use_ssl BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Status and Sync
  status TEXT NOT NULL DEFAULT 'connected', -- 'connected', 'disconnected', 'error'
  sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  error_message TEXT, -- Store error details if status is 'error'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mailboxes_account_id ON mailboxes(account_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_user_id ON mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_email_address ON mailboxes(email_address);
CREATE INDEX IF NOT EXISTS idx_mailboxes_status ON mailboxes(status);
CREATE INDEX IF NOT EXISTS idx_mailboxes_sync_enabled ON mailboxes(sync_enabled);
CREATE INDEX IF NOT EXISTS idx_mailboxes_account_status ON mailboxes(account_id, status);

-- Trigger for updated_at
CREATE TRIGGER update_mailboxes_updated_at
  BEFORE UPDATE ON mailboxes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE mailboxes IS 'Stores SMTP and IMAP credentials for user email accounts. Credentials should be encrypted at rest.';
COMMENT ON COLUMN mailboxes.account_id IS 'The account (organization) this mailbox belongs to.';
COMMENT ON COLUMN mailboxes.user_id IS 'The user who connected this mailbox.';
COMMENT ON COLUMN mailboxes.provider IS 'Email provider type: gmail, outlook, or custom.';
COMMENT ON COLUMN mailboxes.smtp_password IS 'SMTP password - should be encrypted before storage.';
COMMENT ON COLUMN mailboxes.imap_password IS 'IMAP password - should be encrypted before storage.';
COMMENT ON COLUMN mailboxes.status IS 'Connection status: connected, disconnected, or error.';
COMMENT ON COLUMN mailboxes.sync_enabled IS 'Whether to automatically sync emails from this mailbox.';

