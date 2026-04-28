export type FluxPageThemeMode = 'prospect' | 'seller' | 'merge';

/** Per-field override when pageTheme is merge; otherwise ignored. */
export type FluxBrandFieldSource = 'prospect' | 'seller' | 'merge';

export interface FluxBrandingPolicy {
  v: 1;
  pageTheme: FluxPageThemeMode;
  logoFrom?: FluxBrandFieldSource;
  colorsFrom?: FluxBrandFieldSource;
  fontFrom?: FluxBrandFieldSource;
  blockStyleFrom?: FluxBrandFieldSource;
}

export function defaultFluxBrandingPolicy(): FluxBrandingPolicy {
  return { v: 1, pageTheme: 'merge' };
}

function coerceFieldSource(raw: unknown): FluxBrandFieldSource | undefined {
  if (raw === 'prospect' || raw === 'seller' || raw === 'merge') return raw;
  return undefined;
}

export function normalizeFluxBrandingPolicy(raw: unknown): FluxBrandingPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultFluxBrandingPolicy();
  const o = raw as Record<string, unknown>;
  const pageTheme: FluxPageThemeMode =
    o.pageTheme === 'prospect' || o.pageTheme === 'seller' || o.pageTheme === 'merge'
      ? o.pageTheme
      : 'merge';
  return {
    v: 1,
    pageTheme,
    logoFrom: coerceFieldSource(o.logoFrom),
    colorsFrom: coerceFieldSource(o.colorsFrom),
    fontFrom: coerceFieldSource(o.fontFrom),
    blockStyleFrom: coerceFieldSource(o.blockStyleFrom),
  };
}

export function brandingPolicyToJson(policy: FluxBrandingPolicy): Record<string, unknown> {
  const out: Record<string, unknown> = { v: 1, pageTheme: policy.pageTheme };
  if (policy.logoFrom) out.logoFrom = policy.logoFrom;
  if (policy.colorsFrom) out.colorsFrom = policy.colorsFrom;
  if (policy.fontFrom) out.fontFrom = policy.fontFrom;
  if (policy.blockStyleFrom) out.blockStyleFrom = policy.blockStyleFrom;
  return out;
}
