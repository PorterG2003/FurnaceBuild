-- ============================================
-- Migration: Add phone_number to leads
-- ============================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

COMMENT ON COLUMN leads.phone_number IS 'Lead phone number (e.g. from Smartlead or intake).';
