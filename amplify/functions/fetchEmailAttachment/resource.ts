import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Inbox attachment Lambda (Function URL).
 *
 * Actions: prepare_upload, delete_upload, fetch (IMAP or Storage signed GET), drain_gc.
 *
 * Environment:
 * - SUPABASE_URL: from .env.local at deploy time (plain env var)
 * - SUPABASE_SECRET_KEY: secret (Supabase service role key)
 * - INBOX_ATTACHMENT_GC_SECRET: plain env (optional; required for drain_gc)
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
