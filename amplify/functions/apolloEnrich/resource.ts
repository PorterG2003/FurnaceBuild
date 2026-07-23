import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Person enrichment proxy (Apollo primary, Prospeo waterfall) — Function URL +
 * Supabase JWT. Keeps provider API keys server-side and meters usage via the
 * credit system. Requires `APOLLO_API_KEY`, `PROSPEO_API_KEY`, and main-project
 * `SUPABASE_SECRET_KEY`.
 */
export const apolloEnrich = defineFunction({
  name: 'apolloEnrich',
  entry: './handler.ts',
  memoryMB: 256,
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    APOLLO_API_KEY: secret('APOLLO_API_KEY'),
    PROSPEO_API_KEY: secret('PROSPEO_API_KEY'),
  },
});
