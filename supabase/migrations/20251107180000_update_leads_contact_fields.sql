-- ============================================
-- Migration: Update Lead Contact Fields
-- ============================================
-- Removes deprecated phone column and adds richer contact metadata

ALTER TABLE leads
  DROP COLUMN IF EXISTS phone;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS company_linkedin_url TEXT;

COMMENT ON COLUMN leads.first_name IS 'Contact first name captured at intake time.';
COMMENT ON COLUMN leads.last_name IS 'Contact last name captured at intake time.';
COMMENT ON COLUMN leads.company_name IS 'Primary company or organization the lead represents.';
COMMENT ON COLUMN leads.website IS 'Lead website URL, if available.';
COMMENT ON COLUMN leads.linkedin_url IS 'Personal LinkedIn profile URL for the lead.';
COMMENT ON COLUMN leads.company_linkedin_url IS 'Company LinkedIn profile URL associated with the lead.';

