-- ============================================
-- Migration: Create Invitations Table
-- ============================================
-- Tracks pending invitations to join accounts

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'expired'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitations_account_id ON invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_pending ON invitations(account_id, status) WHERE status = 'pending';

-- Create unique partial index to prevent duplicate pending invitations for same account/email
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_unique_pending 
  ON invitations(account_id, email) 
  WHERE status = 'pending';

CREATE TRIGGER update_invitations_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE invitations IS 'Tracks pending invitations for users to join accounts.';
COMMENT ON COLUMN invitations.status IS 'Invitation status: pending, accepted, declined, expired';

