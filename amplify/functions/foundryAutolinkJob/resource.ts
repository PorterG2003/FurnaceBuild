import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker: auto-link ingestion run chunks + finalize/fail job rows.
 * Invoked only by the Foundry autolink state machine (not a public Function URL).
 *
 * LEADS_SUPABASE_URL is set in amplify/backend.ts at synth time.
 * LEADS_SUPABASE_SECRET_KEY uses the same Amplify secret as foundryRegistryApi.
 */
export const foundryAutolinkJob = defineFunction({
  name: 'foundryAutolinkJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
