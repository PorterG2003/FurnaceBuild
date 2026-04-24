import { defineFunction, secret } from '@aws-amplify/backend';

export const fluxEditorChat = defineFunction({
  name: 'fluxEditorChat',
  entry: './handler.ts',
  memoryMB: 512,
  timeoutSeconds: 90,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
  },
});
