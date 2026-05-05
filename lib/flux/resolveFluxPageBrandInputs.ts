import type { BrandProfile } from './types';
import type { FluxBrandingPolicy, FluxBrandFieldSource } from './fluxBrandingPolicy';

const DEFAULT_PRIMARY = '#4f46e5';

function pickColor(
  policy: FluxBrandingPolicy,
  which: 'primary' | 'accent',
  prospect: BrandProfile,
  seller: BrandProfile,
): string {
  const key = which === 'primary' ? 'primaryColor' : 'accentColor';
  const p = prospect[key] || '';
  const s = seller[key] || '';
  const fieldSource: FluxBrandFieldSource | undefined = policy.colorsFrom;
  if (policy.pageTheme === 'prospect') return p || s || DEFAULT_PRIMARY;
  if (policy.pageTheme === 'seller') return s || p || DEFAULT_PRIMARY;
  const src = fieldSource ?? 'merge';
  if (src === 'prospect') return p || s || DEFAULT_PRIMARY;
  if (src === 'seller') return s || p || DEFAULT_PRIMARY;
  return p || s || DEFAULT_PRIMARY;
}

function pickStringField(
  policy: FluxBrandingPolicy,
  pageTheme: 'prospect' | 'seller' | 'merge',
  fieldSource: FluxBrandFieldSource | undefined,
  prospectVal: string | undefined,
  sellerVal: string | undefined,
  mergePrefer: 'prospect_first' | 'seller_first',
): string | undefined {
  if (pageTheme === 'prospect') return prospectVal || sellerVal;
  if (pageTheme === 'seller') return sellerVal || prospectVal;
  const src = fieldSource ?? 'merge';
  if (src === 'prospect') return prospectVal || sellerVal;
  if (src === 'seller') return sellerVal || prospectVal;
  return mergePrefer === 'prospect_first' ? prospectVal || sellerVal : sellerVal || prospectVal;
}

/**
 * Resolves final BrandProfile for `computeTheme` from seller/prospect effective brands and campaign policy.
 * Caller should pass brands already merged with each side's website intel.
 */
export function resolveFluxPageBrandInputs(params: {
  policy: FluxBrandingPolicy;
  prospectBrand: BrandProfile;
  sellerBrand: BrandProfile;
}): BrandProfile {
  const { policy, prospectBrand, sellerBrand } = params;
  const primaryColor = pickColor(policy, 'primary', prospectBrand, sellerBrand);
  const accentColor =
    pickColor(policy, 'accent', prospectBrand, sellerBrand) ||
    prospectBrand.accentColor ||
    sellerBrand.accentColor ||
    primaryColor;
  const fontFamily = pickStringField(
    policy,
    policy.pageTheme,
    policy.fontFrom,
    prospectBrand.fontFamily,
    sellerBrand.fontFamily,
    'prospect_first',
  );
  const logoUrl = pickStringField(
    policy,
    policy.pageTheme,
    policy.logoFrom,
    prospectBrand.logoUrl,
    sellerBrand.logoUrl,
    'seller_first',
  );
  const blockStylePreset =
    policy.pageTheme === 'prospect'
      ? prospectBrand.blockStylePreset ?? sellerBrand.blockStylePreset
      : policy.pageTheme === 'seller'
        ? sellerBrand.blockStylePreset ?? prospectBrand.blockStylePreset
        : (() => {
            const src = policy.blockStyleFrom ?? 'merge';
            if (src === 'prospect') return prospectBrand.blockStylePreset ?? sellerBrand.blockStylePreset;
            if (src === 'seller') return sellerBrand.blockStylePreset ?? prospectBrand.blockStylePreset;
            return prospectBrand.blockStylePreset ?? sellerBrand.blockStylePreset;
          })();

  return {
    primaryColor,
    accentColor,
    fontFamily,
    logoUrl,
    blockStylePreset,
  };
}
