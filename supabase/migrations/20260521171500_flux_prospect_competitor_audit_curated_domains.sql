ALTER TABLE public.flux_prospects
  ADD COLUMN IF NOT EXISTS competitor_audit_curated_domains JSONB;

COMMENT ON COLUMN public.flux_prospects.competitor_audit_curated_domains IS
  'Optional [{ domain, name? }] override for competitor_ad_audit when discoveryMode is curated_domains; used when length >= 3 after parse, else template block list applies.';
