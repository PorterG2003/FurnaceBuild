import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Async leads export worker: generates CSVs for explorer and saved-list exports.
 * Invoked by the leads export state machine.
 */
export const leadsExportJob = defineFunction({
  name: 'leadsExportJob',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
