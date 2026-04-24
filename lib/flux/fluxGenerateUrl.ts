import outputs from '@/amplify_outputs.json';

/**
 * AWS Lambda Function URL for the `fluxGenerate` handler (POST + Bearer Supabase JWT).
 *
 * Populated automatically in `amplify_outputs.json` as `custom.fluxGenerateUrl` after
 * `npx ampx sandbox` / deploy. Optional override: set `EXPO_PUBLIC_FLUX_GENERATE_URL`
 * in `.env.local` if you need to point at a different stage without regenerating outputs.
 */
export function getFluxGenerateUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_FLUX_GENERATE_URL?.trim();
  if (fromEnv) return fromEnv;

  const custom = (outputs as { custom?: { fluxGenerateUrl?: string } }).custom;
  return custom?.fluxGenerateUrl?.trim();
}
