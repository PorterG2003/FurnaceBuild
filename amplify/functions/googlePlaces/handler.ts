import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { placesAutocomplete, placesGetDetails } from '../../../lib/google/places';

const FOUNDRY_FLAG_KEY = 'foundry';
const FLUX_FLAG_KEY = 'flux';

function isFunctionUrlEvent(event: unknown): event is {
  headers: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
} {
  return Boolean(event && typeof event === 'object' && event !== null && 'headers' in event);
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function assertFluxOrFoundryAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const { data, error } = await supabase
    .from('user_access_flags')
    .select('flag_key')
    .eq('user_id', userId)
    .in('flag_key', [FOUNDRY_FLAG_KEY, FLUX_FLAG_KEY])
    .limit(2);

  if (error) {
    console.error('[googlePlaces] user_access_flags query failed', error.message);
    return { ok: false, status: 500, body: { ok: false, error: 'Failed to verify access' } };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, status: 403, body: { ok: false, error: 'Flux or Foundry access denied' } };
  }
  return { ok: true };
}

const requestBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('autocomplete'),
    input: z.string().min(1).max(500),
    includedRegionCodes: z.array(z.string().length(2)).max(15).optional(),
    includedPrimaryTypes: z.array(z.string()).max(5).optional(),
  }),
  z.object({
    action: z.literal('placeDetails'),
    placeId: z.string().min(1).max(512),
  }),
]);

export const handler = async (event: unknown) => {
  try {
    if (!isFunctionUrlEvent(event)) {
      return response(500, { ok: false, error: 'Unsupported invocation' });
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY ?? '';

    if (!supabaseUrl || !supabaseSecretKey || !googleApiKey) {
      return response(500, { ok: false, error: 'Missing server configuration' });
    }

    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
    if (method !== 'POST') {
      return response(405, { ok: false, error: 'Method not allowed' });
    }

    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return response(401, { ok: false, error: 'Missing authorization token' });
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return response(401, { ok: false, error: 'Invalid token' });
    }

    const access = await assertFluxOrFoundryAccess(supabase, user.id);
    if (!access.ok) {
      return response(access.status, access.body);
    }

    const rawBody =
      typeof event.body === 'string'
        ? event.body
          ? event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body
          : '{}'
        : '{}';

    let parsed: z.infer<typeof requestBodySchema>;
    try {
      const json = JSON.parse(rawBody) as unknown;
      const r = requestBodySchema.safeParse(json);
      if (!r.success) {
        return response(400, {
          ok: false,
          error: 'Invalid request body',
          details: r.error.flatten(),
        });
      }
      parsed = r.data;
    } catch {
      return response(400, { ok: false, error: 'Invalid JSON body' });
    }

    if (parsed.action === 'autocomplete') {
      const r = await placesAutocomplete(googleApiKey, {
        input: parsed.input,
        includedRegionCodes: parsed.includedRegionCodes,
        includedPrimaryTypes: parsed.includedPrimaryTypes,
      });
      if (!r.ok) {
        const status = r.status === 429 ? 429 : r.status >= 500 ? 502 : r.status >= 400 ? r.status : 502;
        return response(status, {
          ok: false,
          error: r.message,
          code: 'PLACES_UPSTREAM',
        });
      }
      return response(200, { ok: true, action: 'autocomplete', data: r.json });
    }

    const r = await placesGetDetails(googleApiKey, parsed.placeId);
    if (!r.ok) {
      const status = r.status === 429 ? 429 : r.status >= 500 ? 502 : r.status >= 400 ? r.status : 502;
      return response(status, {
        ok: false,
        error: r.message,
        code: 'PLACES_UPSTREAM',
      });
    }
    return response(200, { ok: true, action: 'placeDetails', data: r.json });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[googlePlaces] unhandled', err);
    return response(500, { ok: false, error: 'Internal error', details: message });
  }
};
