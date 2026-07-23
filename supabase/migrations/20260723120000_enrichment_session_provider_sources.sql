-- ============================================
-- Migration: enrichment session provider attribution
-- ============================================
-- Tracks which provider produced profile vs phone on apollo_enrichment_sessions
-- when Prospeo is used as an Apollo waterfall fallback.

ALTER TABLE apollo_enrichment_sessions
  ADD COLUMN IF NOT EXISTS profile_source text
    CHECK (profile_source IS NULL OR profile_source IN ('apollo', 'prospeo')),
  ADD COLUMN IF NOT EXISTS phone_source text
    CHECK (phone_source IS NULL OR phone_source IN ('apollo', 'prospeo'));

COMMENT ON COLUMN apollo_enrichment_sessions.profile_source IS
  'Provider that produced sync_suggestion (apollo | prospeo).';
COMMENT ON COLUMN apollo_enrichment_sessions.phone_source IS
  'Provider that produced phone_numbers (apollo | prospeo).';
