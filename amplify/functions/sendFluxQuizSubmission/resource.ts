import { defineFunction, secret } from '@aws-amplify/backend';

export const sendFluxQuizSubmission = defineFunction({
  name: 'sendFluxQuizSubmission',
  entry: './handler.ts',
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
