import { normalizeFluxRegionCode } from '@/lib/flux/fluxServiceArea';
import type { FluxServiceArea } from '@/lib/flux/types';

export type PlacesAutocompleteSuggestion = { placeId: string; text: string };

/** Parse Places API (New) `places:autocomplete` JSON body. */
export function parsePlacesAutocompleteSuggestions(data: unknown): PlacesAutocompleteSuggestion[] {
  if (!data || typeof data !== 'object') return [];
  const suggestions = (data as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];
  const out: PlacesAutocompleteSuggestion[] = [];
  for (const s of suggestions) {
    if (!s || typeof s !== 'object') continue;
    const pred = (s as { placePrediction?: unknown }).placePrediction;
    if (!pred || typeof pred !== 'object') continue;
    const p = pred as { placeId?: string; place?: string; text?: { text?: string } };
    const fromPlace =
      typeof p.place === 'string' && p.place.startsWith('places/')
        ? p.place.slice('places/'.length)
        : '';
    const placeId = (typeof p.placeId === 'string' ? p.placeId : fromPlace).trim();
    const text = (typeof p.text?.text === 'string' ? p.text.text : placeId).trim();
    if (placeId) out.push({ placeId, text: text || placeId });
  }
  return out;
}

/** ISO 3166-1 alpha-2 from Places API (New) `addressComponents` (country type). */
export function countryRegionCodeFromPlacesAddressComponents(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const types = (comp as { types?: unknown }).types;
    if (!Array.isArray(types) || !types.includes('country')) continue;
    return normalizeFluxRegionCode((comp as { shortText?: string }).shortText);
  }
  return null;
}

/** Map `places/{id}` GET JSON to {@link FluxServiceArea}. */
export function placeDetailsJsonToFluxServiceArea(json: unknown): FluxServiceArea | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const rawId = typeof o.id === 'string' ? o.id.trim() : '';
  const placeId = rawId.startsWith('places/') ? rawId.slice('places/'.length) : rawId;
  const formattedAddress = typeof o.formattedAddress === 'string' ? o.formattedAddress.trim() : '';
  const loc = o.location as { latitude?: number; longitude?: number } | undefined;
  const lat = loc?.latitude;
  const lng = loc?.longitude;
  const dn = o.displayName as { text?: string } | undefined;
  const regionCode = countryRegionCodeFromPlacesAddressComponents(o.addressComponents) ?? undefined;
  if (!placeId || !formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    placeId,
    formattedAddress,
    latitude: lat as number,
    longitude: lng as number,
    displayName: typeof dn?.text === 'string' && dn.text.trim() ? dn.text.trim() : undefined,
    ...(regionCode ? { regionCode } : {}),
  };
}
