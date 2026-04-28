ALTER TABLE public.flux_prospects
  ADD COLUMN IF NOT EXISTS foundry_company_id UUID,
  ADD COLUMN IF NOT EXISTS website_domain_key TEXT,
  ADD COLUMN IF NOT EXISTS website_intel_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS website_intel_auto_filled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.flux_prospects.foundry_company_id IS
  'Foundry company id (real or Flux shell) resolved for website intelligence reuse.';

COMMENT ON COLUMN public.flux_prospects.website_domain_key IS
  'Normalized website domain key used for Flux-side lookup and caching.';

COMMENT ON COLUMN public.flux_prospects.website_intel_snapshot IS
  'Summary-safe website intelligence snapshot copied from the Foundry registry API for Flux generate and autofill.';

COMMENT ON COLUMN public.flux_prospects.website_intel_auto_filled_at IS
  'When website intelligence was last auto-applied to the prospect brand profile.';
