import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker for async Google Ads verification: finalize/fail job rows after ECS completes.
 * Invoked only by the Foundry Google Ads verification state machine (not a public Function URL).
 */
export const foundryGoogleAdsVerificationJob = defineFunction({
  name: 'foundryGoogleAdsVerificationJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
