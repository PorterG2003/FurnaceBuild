import { defineFunction } from '@aws-amplify/backend';

/**
 * Function to send test messages to SQS queue
 * 
 * Environment variables:
 * - SEND_QUEUE_URL: SQS queue URL (set via CDK in backend.ts from process.env)
 *   Set via: export SEND_QUEUE_URL=... before running npx ampx sandbox
 */
export const sendTestMessage = defineFunction({
  name: 'sendTestMessage',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  // SEND_QUEUE_URL is set via CDK in backend.ts (not a secret, so we pass it directly)
});

