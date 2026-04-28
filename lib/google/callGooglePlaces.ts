import { getAccessToken } from '@/lib/services/auth-token';
import { getGooglePlacesUrl } from './placesUrl';

export type GooglePlacesAutocompleteParams = {
  action: 'autocomplete';
  input: string;
  includedRegionCodes?: string[];
  includedPrimaryTypes?: string[];
};

export type GooglePlacesPlaceDetailsParams = {
  action: 'placeDetails';
  placeId: string;
};

export type GooglePlacesRequestBody = GooglePlacesAutocompleteParams | GooglePlacesPlaceDetailsParams;

export type GooglePlacesAutocompleteSuccess = {
  ok: true;
  action: 'autocomplete';
  data: unknown;
};

export type GooglePlacesPlaceDetailsSuccess = {
  ok: true;
  action: 'placeDetails';
  data: unknown;
};

export type GooglePlacesErrorResult = {
  ok: false;
  message: string;
  status?: number;
  details?: unknown;
};

export type GooglePlacesResult =
  | GooglePlacesAutocompleteSuccess
  | GooglePlacesPlaceDetailsSuccess
  | GooglePlacesErrorResult;

/**
 * POST to `googlePlaces` Lambda with the current user's Supabase access token.
 */
export async function callGooglePlaces(body: GooglePlacesRequestBody): Promise<GooglePlacesResult> {
  const url = getGooglePlacesUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Google Places URL is not configured. Run `npx ampx sandbox` (or deploy), ensure `amplify_outputs.json` includes `custom.googlePlacesUrl`, or set `EXPO_PUBLIC_GOOGLE_PLACES_URL`.',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in.' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const detail = [data.error, data.details].filter(Boolean).join(': ');
    return {
      ok: false,
      message: detail || `Request failed (${res.status})`,
      status: res.status,
      details: data.details,
    };
  }

  if (data.ok !== true) {
    return {
      ok: false,
      message: typeof data.error === 'string' ? data.error : 'Unexpected response',
      status: res.status,
    };
  }

  if (data.action === 'autocomplete') {
    return { ok: true, action: 'autocomplete', data: data.data };
  }
  if (data.action === 'placeDetails') {
    return { ok: true, action: 'placeDetails', data: data.data };
  }

  return { ok: false, message: 'Unexpected response shape', status: res.status };
}
