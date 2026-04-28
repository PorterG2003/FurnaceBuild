import type { BrandProfile, FluxCampaignRow, FluxSellerProfileInput, FluxWebsiteIntelSnapshot } from '@/lib/flux/types';
import { normalizeFluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';

export function emptyFluxSellerProfile(): FluxSellerProfileInput {
  return {
    displayName: '',
    tagline: '',
    websiteUrl: '',
    brand_profile: null,
    website_intel: null,
    websiteDomainKey: null,
    foundryCompanyId: null,
    websiteIntelAutoFilledAt: null,
  };
}

export function sellerProfileFromCampaignRow(row: FluxCampaignRow): FluxSellerProfileInput {
  return {
    displayName: row.seller_display_name ?? '',
    tagline: row.seller_tagline ?? '',
    websiteUrl: row.seller_website_url ?? '',
    brand_profile: row.seller_brand_profile,
    website_intel: row.seller_website_intel_snapshot,
    websiteDomainKey: row.seller_website_domain_key,
    foundryCompanyId: row.seller_foundry_company_id,
    websiteIntelAutoFilledAt: row.seller_website_intel_auto_filled_at,
  };
}

export function parseFluxCampaignRowFromDb(data: Record<string, unknown>): FluxCampaignRow {
  const r = data as Record<string, unknown>;
  return {
    ...(data as unknown as FluxCampaignRow),
    seller_display_name: (r.seller_display_name as string | null | undefined) ?? null,
    seller_tagline: (r.seller_tagline as string | null | undefined) ?? null,
    seller_website_url: (r.seller_website_url as string | null | undefined) ?? null,
    seller_brand_profile: (r.seller_brand_profile as BrandProfile | null | undefined) ?? null,
    seller_website_domain_key: (r.seller_website_domain_key as string | null | undefined) ?? null,
    seller_foundry_company_id: (r.seller_foundry_company_id as string | null | undefined) ?? null,
    seller_website_intel_snapshot: (r.seller_website_intel_snapshot as FluxWebsiteIntelSnapshot | null | undefined) ?? null,
    seller_website_intel_auto_filled_at: (r.seller_website_intel_auto_filled_at as string | null | undefined) ?? null,
    branding_policy: normalizeFluxBrandingPolicy(r.branding_policy),
  };
}
