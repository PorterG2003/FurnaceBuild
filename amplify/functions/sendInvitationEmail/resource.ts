import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Function to send invitation emails via Resend
 * 
 * The RESEND_API_KEY secret must be set using:
 * npx ampx sandbox secret set RESEND_API_KEY
 */
export const sendInvitationEmail = defineFunction({
  name: 'sendInvitationEmail',
  entry: './handler.ts',
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
  },
});

