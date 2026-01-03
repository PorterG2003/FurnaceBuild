-- ============================================
-- Migration: Add account_id to campaigns table
-- ============================================
-- This migration adds account_id to campaigns for efficient mailbox selection
-- Instead of looking up account via owner_id → users → account_users chain,
-- we store account_id directly on campaigns.

-- Add account_id column
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_campaigns_account_id ON campaigns(account_id);

-- Add comment
COMMENT ON COLUMN campaigns.account_id IS 'Account (company) that owns this campaign. Used for mailbox selection and resource access.';

