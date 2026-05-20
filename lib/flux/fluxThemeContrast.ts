import type { ThemeConfig } from './types';
import { parseHexToRgb } from './normalizeFluxHexColor';
import { relativeLuminance } from './fluxColorUtils';

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexLuminance(hex: string): number | null {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return null;
  return relativeLuminance(rgb.r, rgb.g, rgb.b);
}

/** Non-blocking WCAG AA warnings for primary button text contrast. */
export function getFluxThemeContrastWarnings(theme: ThemeConfig): string[] {
  const warnings: string[] = [];
  const bg = hexLuminance(theme.primaryColor);
  const fg = hexLuminance(theme.onPrimaryColor);
  if (bg != null && fg != null) {
    const ratio = contrastRatio(bg, fg);
    if (ratio < 4.5) {
      warnings.push(
        `Theme: primary button text contrast is ${ratio.toFixed(1)}:1 (WCAG AA needs 4.5:1). Adjust primary or "Text on primary".`,
      );
    }
  }
  return warnings;
}
