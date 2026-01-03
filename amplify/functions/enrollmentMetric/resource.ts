import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Enrollment Metric Lambda function
 * 
 * Runs periodically (every 1 minute) to publish enrollment count metric for ECS auto-scaling.
 * Uses Amplify's built-in scheduling feature - automatically creates EventBridge rule.
 * 
 * Environment variables/secrets:
 * - EXPO_PUBLIC_SUPABASE_URL: Environment variable (public URL, not sensitive)
 *   Set via: npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY: Secret (⚠️ SERVICE ROLE KEY with admin privileges - MUST be secret)
 *   Set via: npx ampx sandbox secret set SUPABASE_SERVICE_KEY
 * 
 * Note: AWS_REGION is automatically available in Lambda runtime as process.env.AWS_REGION
 * and should NOT be set manually (it's a reserved environment variable).
 * 
 * Schedule: Every 1 minute (EventBridge minimum is 1 minute)
 * This metric is used by ECS auto-scaling to scale scheduler workers based on enrollment count.
 */
export const enrollmentMetric = defineFunction({
  name: 'enrollmentMetric',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  // Schedule: every 1 minute
  // Automatically creates EventBridge rule and grants Lambda invocation permissions
  schedule: 'every 1m',
  environment: {
    // Environment variables (not sensitive, but using secret() for centralized management)
    EXPO_PUBLIC_SUPABASE_URL: secret('EXPO_PUBLIC_SUPABASE_URL'),
    // Secret (sensitive - MUST use secrets)
    SUPABASE_SERVICE_KEY: secret('SUPABASE_SERVICE_KEY'),
    // AWS_REGION is automatically set by Lambda runtime - don't set it manually
  },
});

