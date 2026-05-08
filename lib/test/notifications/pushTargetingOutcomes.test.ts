import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listActivePushSubscriptionsForUser,
  preferenceEnabled,
} from '../../../amplify/functions/processNotificationEvent/handler.js';
import {
  NotificationsDbHarness,
  createNotificationsTestNamespace,
  loadNotificationsHarnessEnv,
} from './harness';

let envAvailable = true;
let envError: Error | null = null;

try {
  loadNotificationsHarnessEnv();
} catch (error) {
  envAvailable = false;
  envError = error instanceof Error ? error : new Error(String(error));
}

test(
  'user-scoped push subscriptions fan out across accounts while prefs stay account-scoped',
  { skip: envAvailable ? false : envError?.message ?? 'Notifications test env is not configured.' },
  async () => {
    const harness = new NotificationsDbHarness({
      namespace: createNotificationsTestNamespace('notifications-push-targeting'),
    });

    try {
      const seeded = await harness.seedMultiAccountUser();

      const subscriptions = await listActivePushSubscriptionsForUser(
        harness.supabase as any,
        seeded.userId
      );
      assert.equal(subscriptions.length, 2);
      assert.deepEqual(
        subscriptions.map((sub) => sub.id).sort(),
        seeded.pushSubscriptionIds.slice().sort()
      );

      const accountAPref = await preferenceEnabled(
        harness.supabase as any,
        seeded.userId,
        seeded.accountAId,
        'email.received',
        'web_push',
        false,
        'instant'
      );
      const accountBPref = await preferenceEnabled(
        harness.supabase as any,
        seeded.userId,
        seeded.accountBId,
        'email.received',
        'web_push',
        false,
        'instant'
      );

      assert.deepEqual(accountAPref, { enabled: true, frequency: 'instant' });
      assert.deepEqual(accountBPref, { enabled: false, frequency: 'instant' });
    } finally {
      await harness.cleanup();
    }
  }
);
