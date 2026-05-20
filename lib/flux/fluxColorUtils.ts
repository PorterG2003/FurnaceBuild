import { parseHexToRgb, formatRgbToHex } from './normalizeFluxHexColor';

export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Tint a colour toward white by a factor (0 = original, 1 = white). */
export function tintHex(hex: string, factor: number, fallback = '#f5f5f5'): string {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return fallback;
  return formatRgbToHex(
    rgb.r + (255 - rgb.r) * factor,
    rgb.g + (255 - rgb.g) * factor,
    rgb.b + (255 - rgb.b) * factor,
  );
}

/** Pick light or dark foreground for text on `backgroundHex`. */
export function contrastTextForBackground(backgroundHex: string): '#ffffff' | '#1a1a1a' {
  const rgb = parseHexToRgb(backgroundHex);
  if (!rgb) return '#1a1a1a';
  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
  return lum > 0.45 ? '#1a1a1a' : '#ffffff';
}
