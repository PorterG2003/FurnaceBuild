import { defineFunction, secret } from '@aws-amplify/backend';

export const categorizerPreview = defineFunction({
  name: 'categorizerPreview',
  entry: './handler.ts',
  memoryMB: 512,
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
  },
});
