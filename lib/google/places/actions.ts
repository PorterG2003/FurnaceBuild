import type { PlacesFetchResult } from './transport';
import { placesFetch } from './transport';

/** Field mask for autocomplete (New) — keep narrow for billing. */
/** See Places Autocomplete (New) field mask docs — use leaf paths (e.g. `text.text`). */
const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text.text';

/** Minimal place details for forms / enrichment. */
const PLACE_DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,location,addressComponents,internationalPhoneNumber,websiteUri';

/** Text search (New) — narrow field mask for competitor discovery. */
const SEARCH_TEXT_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri';

export interface PlacesSearchTextInput {
  textQuery: string;
  languageCode?: string;
  maxResultCount?: number;
  /** Center + radius in meters (Places API circle bias). */
  locationBias: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
}

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
/** Places API (New) — `places:searchText`. */
export async function placesSearchText(apiKey: string, input: PlacesSearchTextInput): Promise<PlacesFetchResult> {
  const q = input.textQuery.trim();
  if (!q) {
    return { ok: false, status: 400, message: 'textQuery is required' };
  }
  const { latitude, longitude, radiusMeters } = input.locationBias;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters)) {
    return { ok: false, status: 400, message: 'locationBias requires finite latitude, longitude, radiusMeters' };
  }

  const body: Record<string, unknown> = {
    textQuery: q,
    languageCode: input.languageCode?.trim() || 'en-US',
    maxResultCount: Math.min(20, Math.max(1, input.maxResultCount ?? 20)),
    locationBias: {
      circle: {
        center: { latitude, longitude },
        radius: radiusMeters,
      },
    },
  };

  return placesFetch({
    path: 'places:searchText',
    method: 'POST',
    apiKey,
    fieldMask: SEARCH_TEXT_FIELD_MASK,
    body,
  });
}

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
