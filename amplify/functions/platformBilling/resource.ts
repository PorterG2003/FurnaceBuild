import { defineFunction, secret } from '@aws-amplify/backend';

export const platformBilling = defineFunction({
  name: 'platformBilling',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
  },
});
