import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker: normalize ingestion run chunks + finalize/fail job rows.
 * Invoked only by the Foundry normalize state machine (not a public Function URL).
 *
 * LEADS_SUPABASE_URL is set in amplify/backend.ts at synth time.
 * LEADS_SUPABASE_SECRET_KEY uses the same Amplify secret as foundryRegistryApi.
 */
export const foundryNormalizeJob = defineFunction({
  name: 'foundryNormalizeJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
