import type { FluxServiceArea } from './types';

export function isValidFluxServiceArea(raw: unknown): raw is FluxServiceArea {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.placeId !== 'string' || !o.placeId.trim()) return false;
  if (typeof o.formattedAddress !== 'string' || !o.formattedAddress.trim()) return false;
  if (typeof o.latitude !== 'number' || !Number.isFinite(o.latitude)) return false;
  if (typeof o.longitude !== 'number' || !Number.isFinite(o.longitude)) return false;
  if (o.displayName != null && typeof o.displayName !== 'string') return false;
  return true;
}
