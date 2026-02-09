import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Fetch Email Attachment Lambda
 *
 * Fetches attachment binary from IMAP for a given email_message_id and part.
 * Invoked via Function URL (not API Gateway) — 15 min timeout for large attachments.
 *
 * Environment:
 * - SUPABASE_URL: from .env.local at deploy time (plain env var)
 * - SUPABASE_SECRET_KEY: secret (Supabase Secret Key, replaces legacy service role key)
 * - COGNITO_USER_POOL_ID: for JWT verification (passed from auth resource)
 */
export const fetchEmailAttachment = defineFunction({
  name: 'fetchEmailAttachment',
  entry: './handler.ts',
  timeoutSeconds: 900, // 15 minutes for large attachments
  memoryMB: 256,
  environment: {
    // SUPABASE_URL: plain env var, injected from .env.local at deploy time (see backend.ts)
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
