import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Apollo.io person enrichment proxy — Function URL + Supabase JWT.
 * Keeps `APOLLO_API_KEY` server-side and meters usage via the credit system.
 * Requires `APOLLO_API_KEY` and main-project `SUPABASE_SECRET_KEY`.
 */
export const apolloEnrich = defineFunction({
  name: 'apolloEnrich',
  entry: './handler.ts',
  memoryMB: 256,
  timeoutSeconds: 30,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    APOLLO_API_KEY: secret('APOLLO_API_KEY'),
  },
});
