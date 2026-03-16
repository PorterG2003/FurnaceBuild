import { defineFunction, secret } from '@aws-amplify/backend';

export const launchSmartleadMigration = defineFunction({
  name: 'launchSmartleadMigration',
  entry: './handler.ts',
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
