import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Consumes SQS messages `{ eventId }` for notification_events, creates in-app notifications,
 * and sends Web Push when enabled. Deploy worker stack first so the queue export exists.
 */
export const processNotificationEvent = defineFunction({
  name: 'processNotificationEvent',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 256,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    WEB_PUSH_VAPID_PUBLIC_KEY: secret('WEB_PUSH_VAPID_PUBLIC_KEY'),
    WEB_PUSH_VAPID_PRIVATE_KEY: secret('WEB_PUSH_VAPID_PRIVATE_KEY'),
  },
});
