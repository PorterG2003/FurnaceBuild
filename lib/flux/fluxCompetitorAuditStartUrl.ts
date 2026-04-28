import outputs from '@/amplify_outputs.json';

/**
 * Lambda Function URL for `fluxCompetitorAuditStart` (POST + Bearer Supabase JWT).
 * After deploy, `amplify_outputs.json` includes `custom.fluxCompetitorAuditStartUrl`, or set
 * `EXPO_PUBLIC_FLUX_COMPETITOR_AUDIT_START_URL` in `.env.local`.
 */
export function getFluxCompetitorAuditStartUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_FLUX_COMPETITOR_AUDIT_START_URL?.trim();
  if (fromEnv) return fromEnv;

  const custom = (outputs as { custom?: { fluxCompetitorAuditStartUrl?: string } }).custom;
  return custom?.fluxCompetitorAuditStartUrl?.trim();
}
