import type { BrandProfile, ThemeConfig } from './types';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Tint a colour toward white by a factor (0 = original, 1 = white).
 */
function tint(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#f5f5f5';
  return rgbToHex(
    rgb.r + (255 - rgb.r) * factor,
    rgb.g + (255 - rgb.g) * factor,
    rgb.b + (255 - rgb.b) * factor,
  );
}

export function computeTheme(brand: BrandProfile): ThemeConfig {
  const primary = brand.primaryColor || '#4f46e5';
  const accent = brand.accentColor || primary;
  const bg = tint(primary, 0.92);
  const bgRgb = hexToRgb(bg);
  const bgLum = bgRgb ? relativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b) : 0.9;
  const textColor = bgLum > 0.5 ? '#1a1a1a' : '#f5f5f5';

  return {
    primaryColor: primary,
    accentColor: accent,
    backgroundColor: bg,
    textColor,
    fontFamily: brand.fontFamily || 'Inter',
    logoUrl: brand.logoUrl,
  };
}
