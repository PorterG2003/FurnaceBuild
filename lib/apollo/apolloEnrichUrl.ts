import outputs from '@/amplify_outputs.json';

/**
 * Lambda Function URL for the `apolloEnrich` handler (POST + Bearer Supabase JWT).
 *
 * After `npx ampx sandbox` / deploy, `amplify_outputs.json` includes `custom.apolloEnrichUrl`.
 * Override with `EXPO_PUBLIC_APOLLO_ENRICH_URL` in `.env.local` if needed.
 */
export function getApolloEnrichUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_APOLLO_ENRICH_URL?.trim();
  if (fromEnv) return fromEnv;

  const custom = (outputs as { custom?: { apolloEnrichUrl?: string } }).custom;
  return custom?.apolloEnrichUrl?.trim();
}
