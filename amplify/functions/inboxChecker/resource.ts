import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Inbox Checker Lambda function
 * 
 * Runs periodically (every 5 minutes) to check mailboxes for replies/bounces via IMAP.
 * Uses Amplify's built-in scheduling feature - automatically creates EventBridge rule.
 * 
 * Environment variables/secrets:
 * - EXPO_PUBLIC_SUPABASE_URL: Environment variable (public URL, not sensitive)
 *   Set via: npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_URL
 *   (Note: Using secret() for convenience, but value is not sensitive)
 * - SUPABASE_SECRET_KEY: Secret (Supabase Secret Key - bypasses RLS, MUST be secret)
 *   Set via: npx ampx sandbox secret set SUPABASE_SECRET_KEY
 * 
 * Note: AWS_REGION is automatically available in Lambda runtime as process.env.AWS_REGION
 * and should NOT be set manually (it's a reserved environment variable).
 * 
 * Schedule: EventBridge rate expressions have a minimum of 1 minute.
 * We use 'every 5m' for inbox checking (checking every 5 minutes is sufficient).
 * 
 * Timeout: Set to 5 minutes to allow time for IMAP connections and message processing.
 * We process mailboxes sequentially to avoid overwhelming IMAP servers.
 */
export const inboxChecker = defineFunction({
  name: 'inboxChecker',
  entry: './handler.ts',
  timeoutSeconds: 300, // 5 minutes (allows time for IMAP connections and processing)
  memoryMB: 512,
  // Schedule: every 5 minutes
  // Automatically creates EventBridge rule and grants Lambda invocation permissions
  // Note: Amplify schedule format uses 'every Xm' for minutes (minimum 1 minute)
  schedule: 'every 5m',
  environment: {
    // Environment variables (not sensitive, but using secret() for centralized management)
    EXPO_PUBLIC_SUPABASE_URL: secret('EXPO_PUBLIC_SUPABASE_URL'),
    // Secret (sensitive - MUST use secrets)
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    // AWS_REGION is automatically set by Lambda runtime - don't set it manually
  },
});

