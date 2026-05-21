import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions cleanup handler for Flux competitor audits when the ECS task fails
 * before the worker can persist failure state back to Supabase.
 */
export const fluxCompetitorAuditJob = defineFunction({
  name: 'fluxCompetitorAuditJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
