import { PLACES_API_BASE } from './constants';

export type PlacesHttpMethod = 'GET' | 'POST';

export interface PlacesFetchParams {
  /** Path after `/v1/`, e.g. `places:autocomplete` or `places/ChIJ...`. */
  path: string;
  method: PlacesHttpMethod;
  apiKey: string;
  /** Required for most Places (New) calls; comma-separated field paths. */
  fieldMask: string;
  body?: Record<string, unknown>;
}

export type PlacesFetchResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number; message: string };

/**
 * Low-level HTTP call to Places API (New). Caller supplies API key (never log it).
 */
export async function placesFetch(params: PlacesFetchParams): Promise<PlacesFetchResult> {
  const url = `${PLACES_API_BASE}/${params.path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'X-Goog-Api-Key': params.apiKey,
    'X-Goog-FieldMask': params.fieldMask,
  };
  if (params.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: params.method,
      headers,
      ...(params.method === 'POST' && params.body != null
        ? { body: JSON.stringify(params.body) }
        : {}),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, message: msg };
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = formatPlacesErrorMessage(json, res.status);
    return { ok: false, status: res.status, message };
  }

  return { ok: true, status: res.status, json };
}

function formatPlacesErrorMessage(body: unknown, httpStatus: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { message?: string; status?: string } }).error;
    if (err && typeof err.message === 'string' && err.message.trim()) {
      return err.message.trim();
    }
    if (err && typeof err.status === 'string' && err.status.trim()) {
      return err.status.trim();
    }
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message?: string }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return `Places request failed (${httpStatus})`;
}
