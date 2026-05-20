import type { FluxPageHeaderAppearance, ThemeConfig } from './types';
import {
  DEFAULT_FLUX_BLOCK_STYLE_PRESET,
  FLUX_BLOCK_STYLE_PRESETS,
  withFluxAlpha,
  type FluxBlockStylePreset,
} from './fluxPresentationTokens';
import { contrastTextForBackground, tintHex } from './fluxColorUtils';
import { parseHexToRgb } from './normalizeFluxHexColor';

const DEFAULT_PRIMARY = '#4f46e5';
const DEFAULT_BG = '#f5f5f5';
const DEFAULT_TEXT = '#1a1a1a';
const DEFAULT_SURFACE = '#ffffff';
const DEFAULT_ERROR = '#b91c1c';
const DEFAULT_SHADOW = '#0f172a';
const FALLBACK_BORDER = '#e5e7eb';
const FALLBACK_STRONG_BORDER = '#d1d5db';

function normalizePreset(preset: unknown): FluxBlockStylePreset {
  return FLUX_BLOCK_STYLE_PRESETS.includes(preset as FluxBlockStylePreset)
    ? (preset as FluxBlockStylePreset)
    : DEFAULT_FLUX_BLOCK_STYLE_PRESET;
}

function deriveBackgroundFromPrimary(primary: string, explicit?: string): string {
  if (explicit && parseHexToRgb(explicit)) return explicit;
  return tintHex(primary, 0.92, DEFAULT_BG);
}

function deriveTextFromBackground(bg: string, explicit?: string): string {
  if (explicit && parseHexToRgb(explicit)) return explicit;
  return contrastTextForBackground(bg);
}

function coerceHeader(
  header: FluxPageHeaderAppearance | undefined,
  surfaceColor: string,
  borderColor: string,
): FluxPageHeaderAppearance | undefined {
  if (!header || typeof header !== 'object') return undefined;
  const bg =
    typeof header.backgroundColor === 'string' && parseHexToRgb(header.backgroundColor)
      ? header.backgroundColor
      : undefined;
  const border =
    typeof header.borderColor === 'string' && parseHexToRgb(header.borderColor)
      ? header.borderColor
      : undefined;
  if (!bg && !border) return undefined;
  return {
    ...(bg ? { backgroundColor: bg } : {}),
    ...(border ? { borderColor: border } : {}),
  };
}

/**
 * Fill semantic theme roles from brand colors when unset. Safe to call on partial DB JSON.
 */
export function enrichThemeConfig(input: Partial<ThemeConfig> & Pick<ThemeConfig, 'primaryColor'> | Partial<ThemeConfig>): ThemeConfig {
  const primary =
    typeof input.primaryColor === 'string' && parseHexToRgb(input.primaryColor)
      ? input.primaryColor
      : DEFAULT_PRIMARY;
  const accent =
    typeof input.accentColor === 'string' && parseHexToRgb(input.accentColor)
      ? input.accentColor
      : primary;
  const backgroundColor = deriveBackgroundFromPrimary(primary, input.backgroundColor);
  const textColor = deriveTextFromBackground(backgroundColor, input.textColor);
  const surfaceColor =
    typeof input.surfaceColor === 'string' && parseHexToRgb(input.surfaceColor)
      ? input.surfaceColor
      : DEFAULT_SURFACE;
  const onPrimaryColor =
    typeof input.onPrimaryColor === 'string' && parseHexToRgb(input.onPrimaryColor)
      ? input.onPrimaryColor
      : contrastTextForBackground(primary);
  const onSurfaceColor =
    typeof input.onSurfaceColor === 'string' && parseHexToRgb(input.onSurfaceColor)
      ? input.onSurfaceColor
      : textColor;
  const mutedTextColor =
    typeof input.mutedTextColor === 'string' && parseHexToRgb(input.mutedTextColor)
      ? input.mutedTextColor
      : withFluxAlpha(textColor, 'ad');
  const preset = normalizePreset(input.blockStylePreset);
  const borderColor =
    typeof input.borderColor === 'string' && input.borderColor.length > 0
      ? input.borderColor
      : preset === 'minimal'
        ? FALLBACK_BORDER
        : withFluxAlpha(primary, '30');
  const strongBorderColor =
    typeof input.strongBorderColor === 'string' && input.strongBorderColor.length > 0
      ? input.strongBorderColor
      : preset === 'minimal'
        ? FALLBACK_STRONG_BORDER
        : withFluxAlpha(primary, '40');
  const errorColor =
    typeof input.errorColor === 'string' && parseHexToRgb(input.errorColor)
      ? input.errorColor
      : DEFAULT_ERROR;
  const shadowColor =
    typeof input.shadowColor === 'string' && parseHexToRgb(input.shadowColor)
      ? input.shadowColor
      : DEFAULT_SHADOW;

  const header = coerceHeader(input.header, surfaceColor, borderColor);

  return {
    primaryColor: primary,
    accentColor: accent,
    backgroundColor,
    textColor,
    fontFamily: typeof input.fontFamily === 'string' && input.fontFamily.length > 0 ? input.fontFamily : 'Inter',
    surfaceColor,
    onPrimaryColor,
    onSurfaceColor,
    mutedTextColor,
    borderColor,
    strongBorderColor,
    errorColor,
    shadowColor,
    blockStylePreset: preset,
    ...(typeof input.logoUrl === 'string' && input.logoUrl.length > 0 ? { logoUrl: input.logoUrl } : {}),
    ...(typeof input.allowLongCopy === 'boolean' ? { allowLongCopy: input.allowLongCopy } : {}),
    ...(header ? { header } : {}),
  };
}

/** Resolved header chrome for render (defaults from theme when `theme.header` partial or absent). */
export function resolveFluxHeaderAppearance(theme: ThemeConfig): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: theme.header?.backgroundColor ?? theme.surfaceColor,
    borderColor: theme.header?.borderColor ?? theme.borderColor,
  };
}
