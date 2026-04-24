import { defineFunction, secret } from '@aws-amplify/backend';

export const fluxGenerate = defineFunction({
  name: 'fluxGenerate',
  entry: './handler.ts',
  memoryMB: 512,
  timeoutSeconds: 120,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
  },
});
