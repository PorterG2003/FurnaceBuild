import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Google Places API (New) proxy — Function URL + Supabase JWT.
 * Requires `GOOGLE_PLACES_API_KEY` and main-project `SUPABASE_SECRET_KEY`.
 */
export const googlePlaces = defineFunction({
  name: 'googlePlaces',
  entry: './handler.ts',
  memoryMB: 256,
  timeoutSeconds: 30,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    GOOGLE_PLACES_API_KEY: secret('GOOGLE_PLACES_API_KEY'),
  },
});
