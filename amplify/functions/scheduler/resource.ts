import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Scheduler Lambda function
 * 
 * Runs periodically (every 1 minute) to evaluate enrollments and create message_jobs.
 * Uses Amplify's built-in scheduling feature - automatically creates EventBridge rule.
 * 
 * Environment variables/secrets to set:
 * - EXPO_PUBLIC_SUPABASE_URL: Set as secret using: npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_URL
 *   (Same URL as client-side, can reuse the value)
 * - SUPABASE_SERVICE_KEY: Set as secret using: npx ampx sandbox secret set SUPABASE_SERVICE_KEY
 *   (⚠️ This is the SERVICE ROLE KEY, not the anon key - needed for server-side admin operations)
 * - SEND_QUEUE_URL: Set as secret using: npx ampx sandbox secret set SEND_QUEUE_URL
 * 
 * Note: AWS_REGION is automatically available in Lambda runtime as process.env.AWS_REGION
 * and should NOT be set manually (it's a reserved environment variable).
 * 
 * Important: The service role key is different from EXPO_PUBLIC_SUPABASE_ANON_KEY.
 * The service role key has admin privileges and bypasses RLS, which is required
 * for Lambda functions to query enrollments and create message_jobs.
 * 
 * Schedule: EventBridge rate expressions have a minimum of 1 minute.
 * We process enrollments in batches, so 1-minute intervals are sufficient.
 * 
 * Note: Timeout must be <= schedule interval (60s) to prevent overlapping executions.
 * We process up to 50 enrollments per run to stay within the timeout.
 */
export const scheduler = defineFunction({
  name: 'scheduler',
  entry: './handler.ts',
  timeoutSeconds: 60, // 1 minute (must be <= schedule interval to prevent overlapping runs)
  memoryMB: 512,
  // Schedule: every 1 minute (EventBridge minimum is 1 minute)
  // Automatically creates EventBridge rule and grants Lambda invocation permissions
  schedule: 'every 1m',
  environment: {
    // Use same names as client-side for consistency
    EXPO_PUBLIC_SUPABASE_URL: secret('EXPO_PUBLIC_SUPABASE_URL'),
    // Service role key (NOT anon key) - needed for admin operations
    SUPABASE_SERVICE_KEY: secret('SUPABASE_SERVICE_KEY'),
    SEND_QUEUE_URL: secret('SEND_QUEUE_URL'),
    // AWS_REGION is automatically set by Lambda runtime - don't set it manually
  },
});

