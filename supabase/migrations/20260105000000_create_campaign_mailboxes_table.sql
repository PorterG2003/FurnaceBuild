-- ============================================
-- Migration: Create campaign_mailboxes junction table
-- ============================================
-- Creates many-to-many relationship between campaigns and mailboxes
-- Allows campaigns to have multiple assigned mailboxes
-- Scheduler will only use mailboxes assigned to the campaign

CREATE TABLE IF NOT EXISTS campaign_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(campaign_id, mailbox_id) -- Prevent duplicate assignments
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_campaign_mailboxes_campaign_id ON campaign_mailboxes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_mailboxes_mailbox_id ON campaign_mailboxes(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_campaign_mailboxes_campaign_mailbox ON campaign_mailboxes(campaign_id, mailbox_id);

-- Comments
COMMENT ON TABLE campaign_mailboxes IS 'Junction table for many-to-many relationship between campaigns and mailboxes. Scheduler only uses mailboxes assigned to the campaign.';
COMMENT ON COLUMN campaign_mailboxes.campaign_id IS 'Campaign that uses this mailbox';
COMMENT ON COLUMN campaign_mailboxes.mailbox_id IS 'Mailbox assigned to this campaign';

