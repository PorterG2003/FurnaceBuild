import outputs from '@/amplify_outputs.json';

/**
 * Lambda Function URL for the `googlePlaces` handler (POST + Bearer Supabase JWT).
 *
 * After `npx ampx sandbox` / deploy, `amplify_outputs.json` includes `custom.googlePlacesUrl`.
 * Override with `EXPO_PUBLIC_GOOGLE_PLACES_URL` in `.env.local` if needed.
 */
export function getGooglePlacesUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_PLACES_URL?.trim();
  if (fromEnv) return fromEnv;

  const custom = (outputs as { custom?: { googlePlacesUrl?: string } }).custom;
  return custom?.googlePlacesUrl?.trim();
}
