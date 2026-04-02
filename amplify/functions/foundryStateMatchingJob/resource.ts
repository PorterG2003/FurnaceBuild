import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker for async state matching: Utah/Florida ECS orchestration + finalize/fail job rows.
 * Invoked only by the Foundry state-matching state machine (not a public Function URL).
 */
export const foundryStateMatchingJob = defineFunction({
  name: 'foundryStateMatchingJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
