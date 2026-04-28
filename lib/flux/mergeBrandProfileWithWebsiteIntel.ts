import type { BrandProfile, FluxWebsiteIntelSnapshot } from './types';

/**
 * Fills brand colors/logo from website intel when the profile omits them.
 * Matches amplify `fluxGenerate` semantics for prospect (and seller) theme prep.
 */
export function mergeBrandProfileWithWebsiteIntel(
  brandProfile: BrandProfile | null | undefined,
  websiteIntel: FluxWebsiteIntelSnapshot | null | undefined,
): BrandProfile {
  const current: Partial<BrandProfile> = brandProfile ?? {};
  const site = websiteIntel?.site_assets;
  const themeColor = site?.theme_color ?? undefined;
  const brandColors = (site?.brand_color_candidates ?? []).filter((c: unknown): c is string => typeof c === 'string');
  const logoCandidates = (site?.logo_candidates ?? []).filter((c: unknown): c is string => typeof c === 'string');
  const primary =
    (typeof current.primaryColor === 'string' && current.primaryColor
      ? current.primaryColor
      : undefined) ||
    themeColor ||
    brandColors[0] ||
    '#4f46e5';
  const accent =
    (typeof current.accentColor === 'string' && current.accentColor ? current.accentColor : undefined) ||
    brandColors[1] ||
    brandColors[0] ||
    primary;
  return {
    primaryColor: primary,
    accentColor: accent,
    fontFamily: current.fontFamily,
    logoUrl: (typeof current.logoUrl === 'string' && current.logoUrl ? current.logoUrl : undefined) || logoCandidates[0],
    blockStylePreset: current.blockStylePreset,
  };
}
