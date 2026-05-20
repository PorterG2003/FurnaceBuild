import { defineFunction, secret } from '@aws-amplify/backend';

export const processWebhookEvent = defineFunction({
  name: 'processWebhookEvent',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 256,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
