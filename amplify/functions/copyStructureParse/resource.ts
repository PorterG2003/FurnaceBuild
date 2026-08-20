import { defineFunction, secret } from '@aws-amplify/backend';

export const copyStructureParse = defineFunction({
  name: 'copyStructureParse',
  entry: './handler.ts',
  timeoutSeconds: 300,
  memoryMB: 512,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
    COPY_PARSE_INTERNAL_SECRET: secret('WEBHOOK_ENQUEUE_SECRET'),
  },
});
