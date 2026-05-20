import { defineFunction, secret } from '@aws-amplify/backend';

export const clientApiBulkImport = defineFunction({
  name: 'clientApiBulkImport',
  entry: './handler.ts',
  memoryMB: 1024,
  timeoutSeconds: 300,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
