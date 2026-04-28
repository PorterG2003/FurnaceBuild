-- Flux campaigns: seller identity, brand, website intelligence (mirror prospect pattern), branding policy

ALTER TABLE public.flux_campaigns
  ADD COLUMN IF NOT EXISTS seller_display_name TEXT,
  ADD COLUMN IF NOT EXISTS seller_tagline TEXT,
  ADD COLUMN IF NOT EXISTS seller_website_url TEXT,
  ADD COLUMN IF NOT EXISTS seller_brand_profile JSONB,
  ADD COLUMN IF NOT EXISTS seller_website_domain_key TEXT,
  ADD COLUMN IF NOT EXISTS seller_foundry_company_id UUID,
  ADD COLUMN IF NOT EXISTS seller_website_intel_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS seller_website_intel_auto_filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS branding_policy JSONB NOT NULL DEFAULT '{"v":1,"pageTheme":"merge"}'::jsonb;

COMMENT ON COLUMN public.flux_campaigns.seller_display_name IS
  'Organization running the campaign (seller), for AI context and UI.';

COMMENT ON COLUMN public.flux_campaigns.seller_tagline IS
  'Short seller positioning line; optional.';

COMMENT ON COLUMN public.flux_campaigns.seller_website_url IS
  'Seller website URL used to trigger Foundry website intelligence scrape.';

COMMENT ON COLUMN public.flux_campaigns.seller_brand_profile IS
  'Seller BrandProfile JSON (colors, font, logo) — CRM-side defaults; merged into page theme per branding_policy.';

COMMENT ON COLUMN public.flux_campaigns.seller_website_domain_key IS
  'Normalized domain key for seller website intel lookup/caching.';

COMMENT ON COLUMN public.flux_campaigns.seller_foundry_company_id IS
  'Optional Foundry company id when registry ties intel to a company row.';

COMMENT ON COLUMN public.flux_campaigns.seller_website_intel_snapshot IS
  'Website intelligence snapshot for seller (same shape as prospect); used in generate and editor chat.';

COMMENT ON COLUMN public.flux_campaigns.seller_website_intel_auto_filled_at IS
  'When seller website intelligence was last auto-applied to seller_brand_profile.';

COMMENT ON COLUMN public.flux_campaigns.branding_policy IS
  'Versioned JSON: pageTheme prospect|seller|merge; optional logoFrom, colorsFrom, fontFrom, blockStyleFrom.';
