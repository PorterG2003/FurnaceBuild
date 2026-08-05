import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Enrollment Metric Lambda function
 *
 * Publishes EnrollmentsReadyToProcess for monitoring. No ECS autoscaling policy
 * currently consumes this metric (desired counts are fixed in worker IaC).
 *
 * Schedule slowed from every 1m → every 15m to cut Lambda/KMS secret-resolve cost
 * during an observation period before possible deletion.
 *
 * Public Supabase URL is injected as a plain environment value in amplify/backend.ts
 * (not via secret()) to avoid unnecessary KMS decrypts on cold start.
 */
export const enrollmentMetric = defineFunction({
  name: 'enrollmentMetric',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  schedule: 'every 15m',
  environment: {
    // Sensitive — MUST remain a secret
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    // AWS_REGION is automatically set by Lambda runtime - don't set it manually
  },
});
