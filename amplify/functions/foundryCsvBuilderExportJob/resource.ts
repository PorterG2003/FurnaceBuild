import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Step Functions worker: CSV Builder async export generation.
 * Invoked only by the Foundry CSV Builder export state machine.
 */
export const foundryCsvBuilderExportJob = defineFunction({
  name: 'foundryCsvBuilderExportJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: {
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
