import type { BrandProfile, FluxWebsiteIntelSnapshot, PageConfig } from './types';
import { defaultFluxBrandingPolicy, type FluxBrandingPolicy } from './fluxBrandingPolicy';
import { mergeBrandProfileWithWebsiteIntel } from './mergeBrandProfileWithWebsiteIntel';
import { resolveFluxPageBrandInputs } from './resolveFluxPageBrandInputs';

function normalizeLogoUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveFluxPageLogoUrl(params: {
  prospectBrand: BrandProfile | null | undefined;
  prospectWebsiteIntel?: FluxWebsiteIntelSnapshot | null;
  sellerBrand?: BrandProfile | null;
  sellerWebsiteIntel?: FluxWebsiteIntelSnapshot | null;
  brandingPolicy?: FluxBrandingPolicy | null;
}): string | undefined {
  const prospectMerged = mergeBrandProfileWithWebsiteIntel(
    params.prospectBrand ?? undefined,
    params.prospectWebsiteIntel ?? null,
  );
  const hasSellerContext =
    params.sellerBrand != null || params.sellerWebsiteIntel != null || params.brandingPolicy != null;
  if (!hasSellerContext) {
    return normalizeLogoUrl(prospectMerged.logoUrl);
  }

  const sellerMerged = mergeBrandProfileWithWebsiteIntel(
    params.sellerBrand ?? undefined,
    params.sellerWebsiteIntel ?? null,
  );
  const resolved = resolveFluxPageBrandInputs({
    policy: params.brandingPolicy ?? defaultFluxBrandingPolicy(),
    prospectBrand: prospectMerged,
    sellerBrand: sellerMerged,
  });
  return normalizeLogoUrl(resolved.logoUrl);
}

export function syncFluxPageConfigLogo(
  pageConfig: PageConfig,
  params: {
    prospectBrand: BrandProfile | null | undefined;
    prospectWebsiteIntel?: FluxWebsiteIntelSnapshot | null;
    sellerBrand?: BrandProfile | null;
    sellerWebsiteIntel?: FluxWebsiteIntelSnapshot | null;
    brandingPolicy?: FluxBrandingPolicy | null;
  },
): PageConfig {
  const currentLogoUrl = normalizeLogoUrl(pageConfig.theme.logoUrl);
  const nextLogoUrl = resolveFluxPageLogoUrl(params);
  if (currentLogoUrl === nextLogoUrl) return pageConfig;

  return {
    ...pageConfig,
    theme: {
      ...pageConfig.theme,
      ...(nextLogoUrl ? { logoUrl: nextLogoUrl } : { logoUrl: undefined }),
    },
  };
}
