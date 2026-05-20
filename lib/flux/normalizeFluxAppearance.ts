import type { FluxBlockAppearance, FluxPageHeaderAppearance, ThemeConfig } from './types';
import { normalizeFluxHexColor } from './normalizeFluxHexColor';

const APPEARANCE_KEYS: (keyof FluxBlockAppearance)[] = [
  'sectionBackgroundColor',
  'surfaceColor',
  'panelSurfaceColor',
  'textColor',
  'headingColor',
  'mutedTextColor',
  'primaryColor',
  'accentColor',
  'onPrimaryColor',
  'borderColor',
  'errorColor',
];

function normalizeHexField(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return normalizeFluxHexColor(value) ?? undefined;
}

export function normalizeFluxBlockAppearance(raw: unknown): FluxBlockAppearance | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: FluxBlockAppearance = {};
  for (const key of APPEARANCE_KEYS) {
    const v = normalizeHexField((raw as Record<string, unknown>)[key]);
    if (v) (out as Record<string, string>)[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeFluxPageHeaderAppearance(raw: unknown): FluxPageHeaderAppearance | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const bg = normalizeHexField((raw as Record<string, unknown>).backgroundColor);
  const border = normalizeHexField((raw as Record<string, unknown>).borderColor);
  if (!bg && !border) return undefined;
  return {
    ...(bg ? { backgroundColor: bg } : {}),
    ...(border ? { borderColor: border } : {}),
  };
}

type ThemeHexKey =
  | 'primaryColor'
  | 'accentColor'
  | 'backgroundColor'
  | 'textColor'
  | 'surfaceColor'
  | 'onPrimaryColor'
  | 'onSurfaceColor'
  | 'mutedTextColor'
  | 'borderColor'
  | 'strongBorderColor'
  | 'errorColor'
  | 'shadowColor';

const THEME_HEX_KEYS: ThemeHexKey[] = [
  'primaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'surfaceColor',
  'onPrimaryColor',
  'onSurfaceColor',
  'mutedTextColor',
  'borderColor',
  'strongBorderColor',
  'errorColor',
  'shadowColor',
];

/** Normalize hex fields on theme before save; returns new theme object. */
export function normalizeThemeConfigHex(theme: ThemeConfig): ThemeConfig {
  const next: ThemeConfig = { ...theme };
  for (const key of THEME_HEX_KEYS) {
    const v = next[key];
    if (typeof v === 'string') {
      const n = normalizeFluxHexColor(v);
      if (n) next[key] = n;
    }
  }
  if (theme.header) {
    const header = normalizeFluxPageHeaderAppearance(theme.header);
    if (header) next.header = header;
    else delete next.header;
  }
  return next;
}
