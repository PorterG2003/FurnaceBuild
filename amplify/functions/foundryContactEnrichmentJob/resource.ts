import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker: manual import-run contact enrichment chunks + finalize/fail job rows.
 * Invoked only by the Foundry contact enrichment state machine (not a public Function URL).
 *
 * LEADS_SUPABASE_URL is set in amplify/backend.ts at synth time.
 * LEADS_SUPABASE_SECRET_KEY and SKIPSHERPA_API_KEY use Amplify secrets.
 */
export const foundryContactEnrichmentJob = defineFunction({
  name: 'foundryContactEnrichmentJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
    SKIPSHERPA_API_KEY: secret('SKIPSHERPA_API_KEY'),
  },
});
