import { defineFunction, secret } from '@aws-amplify/backend';

export const sendPlatformInvitationEmail = defineFunction({
  name: 'sendPlatformInvitationEmail',
  resourceGroupName: 'data',
  entry: './handler.ts',
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
