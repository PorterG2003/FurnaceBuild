import type { BrandProfile, ThemeConfig } from './types';
import { enrichThemeConfig } from './enrichThemeConfig';

export function computeTheme(brand: BrandProfile): ThemeConfig {
  return enrichThemeConfig({
    primaryColor: brand.primaryColor || '#4f46e5',
    accentColor: brand.accentColor,
    fontFamily: brand.fontFamily || 'Inter',
    logoUrl: brand.logoUrl,
    blockStylePreset: brand.blockStylePreset,
  });
}
