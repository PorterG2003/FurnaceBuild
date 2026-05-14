import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { useAccount } from '@/contexts/AccountContext';
import { useNotifications } from '@/hooks/useNotifications';
import { NOTIFICATION_TYPE_CATALOG } from '@/lib/notifications/notification-types';
import {
  createTestNotification,
  listActivePushSubscriptions,
  upsertPushSubscription,
} from '@/lib/supabase/services/notifications';
import {
  subscribeWebPush,
  getWebPushVapidPublicKey,
} from '@/lib/notifications/webPushClient';

const WIRED_TEST_EVENT_TYPES = new Set<string>(['email.received']);

export default function NotificationsTestPage() {
  const { toast } = useToast();
  const { account } = useAccount();
  const accountId = account?.id ?? null;
  const { items, loading, error, refresh } = useNotifications(accountId);
  const [dbBusy, setDbBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [subCount, setSubCount] = useState(0);

  const sortedCatalog = useMemo(
    () => [...NOTIFICATION_TYPE_CATALOG].sort((a, b) => a.order - b.order),
    []
  );

  const loadSubs = useCallback(async () => {
    try {
      const subs = await listActivePushSubscriptions();
      setSubCount(subs.length);
    } catch {
      setSubCount(0);
    }
  }, []);

  useEffect(() => {
    void loadSubs();
  }, [loadSubs]);

  const onCreateDbNotification = async (eventTypeId: string) => {
    if (!accountId) return;
    setDbBusy(true);
    try {
      await createTestNotification(accountId, {
        title: `Test: ${eventTypeId}`,
        body: 'Created via /test/notifications (database + Realtime).',
      });
      await refresh();
      toast.success('Test notification created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create notification');
    } finally {
      setDbBusy(false);
    }
  };

  const onToastOnly = () => {
    toast.notification('Test in-app style — toast only (no database row).');
  };

  const enableDeviceAlerts = async () => {
    if (!accountId) return;
    if (Platform.OS !== 'web') {
      toast.warning('Device alerts can be turned on from Furnace in your desktop or phone browser.');
      return;
    }
    if (!getWebPushVapidPublicKey()) {
      toast.error(
        'Missing EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY in this build (add in Amplify env for web export, same key as Lambda).'
      );
      return;
    }
    setPushBusy(true);
    try {
      const sub = await subscribeWebPush();
      if (!sub) {
        toast.warning('We need permission to show alerts when Furnace is in the background.');
        return;
      }
      await upsertPushSubscription(
        {
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        },
        typeof navigator !== 'undefined' ? navigator.userAgent : null
      );
      await loadSubs();
      toast.success('This device is registered for Web Push.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setPushBusy(false);
    }
  };

  const showSwNotification = async () => {
    if (Platform.OS !== 'web') {
      toast.warning('Open this page in a browser to try service worker notifications.');
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast.error('Notifications are not supported in this environment.');
      return;
    }
    if (Notification.permission !== 'granted') {
      toast.warning('Allow notifications in the browser first (e.g. use “Allow alerts on this device” or the site permission prompt).');
      return;
    }
    if (!('serviceWorker' in navigator)) {
      toast.error('No service worker available.');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Furnace test (service worker)', {
        body: 'Same SW as VAPID push delivery — this call is local, not from the server.',
        icon: '/web-app-manifest-512x512.png',
        data: { url: '/test/notifications' },
        tag: 'furnace-test-notification',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not show notification');
    }
  };

  return (
    <PageLayout>
      <View className="mb-6">
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          Notifications test playground
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          In-app (database + list page), toast-only, and browser / service worker checks
        </Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {!accountId ? (
          <Text className="text-amber-400 text-sm mb-6">Select an account to run these tests.</Text>
        ) : null}

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            In-app (database)
          </Text>
          <Text className="text-gray-500 text-xs mb-3 leading-5">
            Inserts a real row into notifications (via RPC). Expect the entry on Settings → View notifications (/notifications)
            and a neutral toast if Realtime is enabled and this account is active.
          </Text>
          <View className="gap-3">
            {sortedCatalog.map((def) => {
              const wired = WIRED_TEST_EVENT_TYPES.has(def.id);
              return (
                <View key={def.id} className="gap-2">
                  <Text className="text-white text-sm font-instrument-medium">{def.title}</Text>
                  {def.description ? (
                    <Text className="text-gray-500 text-xs leading-5">{def.description}</Text>
                  ) : null}
                  <Button
                    onPress={() => void onCreateDbNotification(def.id)}
                    disabled={!accountId || !wired || dbBusy}
                    variant="default"
                    className="bg-brand-orange border-0 self-start"
                  >
                    {!wired ? 'Not wired in test RPC yet' : dbBusy ? 'Creating…' : `Create test · ${def.id}`}
                  </Button>
                </View>
              );
            })}
          </View>
        </View>

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            In-app toast only (UI)
          </Text>
          <Text className="text-gray-500 text-xs mb-3 leading-5">
            Same toast style as NotificationToastSubscriber, without writing to the database.
          </Text>
          <Button
            onPress={onToastOnly}
            variant="default"
            className="bg-[#2A2A2A] border border-[#3A3A3A] self-start"
          >
            Show notification toast
          </Button>
        </View>

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            Push / OS notification (client)
          </Text>
          <Text className="text-gray-500 text-xs mb-3 leading-5">
            Register this browser for Web Push (VAPID public key) and show a test notification through the registered
            service worker — no server round-trip.
          </Text>
          {Platform.OS === 'web' ? (
            <View className="gap-3">
              <Text className="text-gray-400 text-sm">
                Active push subscriptions for this user: {subCount}
              </Text>
              <Button
                onPress={() => void enableDeviceAlerts()}
                disabled={!accountId || pushBusy}
                variant="default"
                className="bg-white/10 border border-white/20 self-start"
              >
                {pushBusy ? 'Working…' : subCount > 0 ? 'Update device permission' : 'Allow alerts on this device'}
              </Button>
              <Button
                onPress={() => void showSwNotification()}
                variant="default"
                className="bg-white/10 border border-white/20 self-start"
              >
                Show test notification (service worker)
              </Button>
            </View>
          ) : (
            <Text className="text-gray-500 text-sm leading-5">
              Open Furnace in a desktop or mobile browser to exercise Web Push and service worker notifications.
            </Text>
          )}
        </View>

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            Real Web Push (server)
          </Text>
          <Text className="text-gray-500 text-xs leading-5">
            A VAPID push from the backend runs when notification_events are processed through SQS and the
            processNotificationEvent Lambda (see docs/notifications/NOTIFICATIONS.md). This page cannot trigger that
            with the app key alone; use a real inbound email path or ops tooling in a full environment.
          </Text>
        </View>

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            Recent notifications (this account)
          </Text>
          <Button
            onPress={() => void refresh()}
            disabled={!accountId}
            variant="default"
            className="bg-white/10 border border-white/20 self-start mb-3"
          >
            Reload list
          </Button>
          {error ? <Text className="text-red-400 text-sm mb-2">{error}</Text> : null}
          {loading && items.length === 0 ? (
            <Text className="text-gray-400 text-sm">Loading…</Text>
          ) : items.length === 0 ? (
            <Text className="text-gray-500 text-sm">No notifications yet.</Text>
          ) : (
            <View className="border border-[#2A2A2A] rounded-xl overflow-hidden">
              {items.slice(0, 10).map((n) => (
                <View key={n.id} className="px-3 py-2 border-b border-[#2A2A2A] last:border-b-0">
                  <Text className="text-white text-sm font-instrument-medium">{n.title}</Text>
                  {n.body ? (
                    <Text className="text-gray-400 text-xs mt-1" numberOfLines={2}>
                      {n.body}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </PageLayout>
  );
}
