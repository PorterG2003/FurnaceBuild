-- ============================================
-- Migration: Add jitter_percentage to accounts table
-- ============================================
-- This migration adds jitter configuration at the account level.
-- Jitter is a random delay applied to scheduled times to avoid pattern fingerprints.
-- Default: 10% (can be overridden per campaign)

-- Add jitter_percentage column to accounts
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS jitter_percentage REAL DEFAULT 10.0;

-- Add constraint: jitter must be between 0 and 100
ALTER TABLE accounts
ADD CONSTRAINT accounts_jitter_percentage_check 
CHECK (jitter_percentage >= 0 AND jitter_percentage <= 100);

-- Add comment
COMMENT ON COLUMN accounts.jitter_percentage IS 'Default jitter percentage (0-100) for campaigns in this account. Can be overridden per campaign. Default: 10%';

