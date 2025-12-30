-- ============================================
-- Migration: Add jitter_percentage to campaigns table
-- ============================================
-- This migration adds jitter configuration at the campaign level.
-- Campaign jitter overrides account jitter if set.
-- If NULL, uses account jitter (or default 10%).

-- Add jitter_percentage column to campaigns
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS jitter_percentage REAL;

-- Add constraint: jitter must be between 0 and 100
ALTER TABLE campaigns
ADD CONSTRAINT campaigns_jitter_percentage_check 
CHECK (jitter_percentage IS NULL OR (jitter_percentage >= 0 AND jitter_percentage <= 100));

-- Add comment
COMMENT ON COLUMN campaigns.jitter_percentage IS 'Campaign-specific jitter percentage (0-100). If NULL, uses account jitter. If account jitter is also NULL, uses default 10%.';

