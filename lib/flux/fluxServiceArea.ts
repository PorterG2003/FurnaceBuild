import type { FluxServiceArea } from './types';

export const DEFAULT_FLUX_TRANSPARENCY_REGION = 'US';

/** Normalize ISO 3166-1 alpha-2 country codes from Places or stored JSON. */
export function normalizeFluxRegionCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Google Ads Transparency Center `region` query param for a saved service area. */
export function fluxServiceAreaTransparencyRegion(
  area: FluxServiceArea | null | undefined,
): string {
  return normalizeFluxRegionCode(area?.regionCode) ?? DEFAULT_FLUX_TRANSPARENCY_REGION;
}

/** Read `regionCode` from a `flux_prospects.service_area` JSONB row (legacy rows default to US). */
export function fluxServiceAreaTransparencyRegionFromRaw(raw: unknown): string {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_FLUX_TRANSPARENCY_REGION;
  }
  return normalizeFluxRegionCode((raw as Record<string, unknown>).regionCode) ?? DEFAULT_FLUX_TRANSPARENCY_REGION;
}

export function isValidFluxServiceArea(raw: unknown): raw is FluxServiceArea {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.placeId !== 'string' || !o.placeId.trim()) return false;
  if (typeof o.formattedAddress !== 'string' || !o.formattedAddress.trim()) return false;
  if (typeof o.latitude !== 'number' || !Number.isFinite(o.latitude)) return false;
  if (typeof o.longitude !== 'number' || !Number.isFinite(o.longitude)) return false;
  if (o.displayName != null && typeof o.displayName !== 'string') return false;
  if (o.regionCode != null && normalizeFluxRegionCode(o.regionCode) == null) return false;
  return true;
}
