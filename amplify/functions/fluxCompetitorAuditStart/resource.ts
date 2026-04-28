import { defineFunction, secret } from '@aws-amplify/backend';

/** Starts Step Functions → ECS google-ads-verification worker (Flux competitor audit mode). */
export const fluxCompetitorAuditStart = defineFunction({
  name: 'fluxCompetitorAuditStart',
  entry: './handler.ts',
  memoryMB: 256,
  timeoutSeconds: 30,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
