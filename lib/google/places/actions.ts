import type { PlacesFetchResult } from './transport';
import { placesFetch } from './transport';

/** Field mask for autocomplete (New) — keep narrow for billing. */
/** See Places Autocomplete (New) field mask docs — use leaf paths (e.g. `text.text`). */
const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text.text';

/** Minimal place details for forms / enrichment. */
const PLACE_DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,location,addressComponents,internationalPhoneNumber,websiteUri';

export interface PlacesAutocompleteInput {
  input: string;
  /** ISO 3166-1 alpha-2, upper-case, e.g. `US`. */
  includedPrimaryTypes?: string[];
  includedRegionCodes?: string[];
}

export async function placesAutocomplete(
  apiKey: string,
  input: PlacesAutocompleteInput,
): Promise<PlacesFetchResult> {
  const trimmed = input.input.trim();
  if (!trimmed) {
    return { ok: false, status: 400, message: 'input is required' };
  }

  const body: Record<string, unknown> = { input: trimmed };
  if (input.includedRegionCodes?.length) {
    body.includedRegionCodes = input.includedRegionCodes.map((c) => c.trim().toUpperCase());
  }
  if (input.includedPrimaryTypes?.length) {
    body.includedPrimaryTypes = input.includedPrimaryTypes;
  }

  return placesFetch({
    path: 'places:autocomplete',
    method: 'POST',
    apiKey,
    fieldMask: AUTOCOMPLETE_FIELD_MASK,
    body,
  });
}

/** `placeId` may be `ChIJ...` or `places/ChIJ...`. */
export async function placesGetDetails(apiKey: string, placeId: string): Promise<PlacesFetchResult> {
  const raw = placeId.trim();
  if (!raw) {
    return { ok: false, status: 400, message: 'placeId is required' };
  }
  const id = raw.startsWith('places/') ? raw.slice('places/'.length) : raw;
  const path = `places/${encodeURIComponent(id)}`;

  return placesFetch({
    path,
    method: 'GET',
    apiKey,
    fieldMask: PLACE_DETAILS_FIELD_MASK,
  });
}
