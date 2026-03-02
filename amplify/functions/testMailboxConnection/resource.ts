import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Function to test mailbox SMTP and IMAP connections
 */
export const testMailboxConnection = defineFunction({
  name: 'testMailboxConnection',
  entry: './handler.ts',
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});

