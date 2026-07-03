import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/button';
import { Skeleton, useToast } from '@/components/ui/feedback';
import {
  getNotificationPreferences,
  upsertNotificationPreference,
  listActivePushSubscriptions,
  upsertPushSubscription,
} from '@/lib/supabase/services/notifications';
import type { PrefRow } from '@/lib/supabase/services/notifications';
import { NOTIFICATION_TYPE_CATALOG } from '@/lib/notifications/notification-types';
import {
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  Squares2X2Icon,
} from 'react-native-heroicons/outline';
import {
  subscribeWebPush,
  getWebPushVapidPublicKey,
} from '@/lib/notifications/webPushClient';
import { useOnboardingOptional } from '@/components/onboarding/context';
import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { TARGETS } from '@/lib/onboarding/types';
import { accountNotificationsOnboardingComplete } from '@/lib/notifications/accountNotificationsOnboarding';

type PrefChannel = 'in_app' | 'web_push';

function channelEnabledForEvent(
  prefs: PrefRow[],
  eventType: string,
  channel: PrefChannel,
  defaultOn: boolean
): boolean {
  const row = prefs.find((p) => p.event_type === eventType && p.channel === channel);
  if (!row) return defaultOn;
  return row.enabled && row.frequency !== 'muted';
}

function effectiveChannelEnabled(
  prefs: PrefRow[],
  eventType: string,
  channel: PrefChannel,
  defaultOn: boolean,
  optimisticByEvent: Record<string, Partial<Record<PrefChannel, boolean>>>
): boolean {
  const o = optimisticByEvent[eventType]?.[channel];
  if (o !== undefined) return o;
  return channelEnabledForEvent(prefs, eventType, channel, defaultOn);
}

function NotificationPrefSkeleton() {
  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 gap-3">
      <Skeleton style={{ width: 140, height: 16, borderRadius: 4 }} />
      <Skeleton style={{ width: '100%', height: 12, borderRadius: 4, maxWidth: 260 }} />
      <Skeleton style={{ width: '100%', height: 36, borderRadius: 8 }} />
      <Skeleton style={{ width: '100%', height: 36, borderRadius: 8 }} />
    </View>
  );
}

export function AccountNotificationsSection({
  accountId,
  cardVariant,
  cardClassName,
  titleClassName,
  initialPrefs,
  initialSubCount,
}: {
  accountId: string;
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  initialPrefs?: PrefRow[];
  initialSubCount?: number;
}) {
  const router = useRouter();
  const accountNotificationsRef = useOnboardingTarget(TARGETS.accountNotifications);
  const onboarding = useOnboardingOptional();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const { toast } = useToast();
  const hasInitialData = initialPrefs !== undefined;
  const [loading, setLoading] = useState(!hasInitialData);
  const [prefs, setPrefs] = useState<PrefRow[]>(initialPrefs ?? []);
  const [pushBusy, setPushBusy] = useState(false);
  const [subCount, setSubCount] = useState(initialSubCount ?? 0);
  const [optimisticByEvent, setOptimisticByEvent] = useState<
    Record<string, Partial<Record<PrefChannel, boolean>>>
  >({});
  const saveGenerationRef = useRef<Record<string, number>>({});

  const sortedCatalog = useMemo(
    () => [...NOTIFICATION_TYPE_CATALOG].sort((a, b) => a.order - b.order),
    []
  );

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const [prefRows, subs] = await Promise.all([
        getNotificationPreferences(accountId),
        listActivePushSubscriptions(),
      ]);
      setPrefs(prefRows);
      setSubCount(subs.length);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (hasInitialData) return;
    void load();
  }, [hasInitialData, load]);

  useEffect(() => {
    if (initialPrefs !== undefined) {
      setPrefs(initialPrefs);
      setSubCount(initialSubCount ?? 0);
      setLoading(false);
    }
  }, [initialPrefs, initialSubCount]);

  useEffect(() => {
    setOptimisticByEvent({});
    saveGenerationRef.current = {};
  }, [accountId]);

  const onboardingNotificationsStepActive =
    onboarding?.currentStep?.kind === 'spotlight' &&
    onboarding.currentStep.targetId === TARGETS.accountNotifications;

  useEffect(() => {
    if (!onboarding?.setAdvanceGateBlocked) return;
    if (!onboardingNotificationsStepActive) return;
    if (loading) {
      onboarding.setAdvanceGateBlocked(true);
      return;
    }
    onboarding.setAdvanceGateBlocked(
      !accountNotificationsOnboardingComplete(prefs, subCount, optimisticByEvent),
    );
  }, [
    onboardingNotificationsStepActive,
    loading,
    prefs,
    subCount,
    optimisticByEvent,
    onboarding,
  ]);

  const clearOptimisticChannel = useCallback((eventType: string, channel: PrefChannel) => {
    setOptimisticByEvent((prev) => {
      const branch = prev[eventType];
      if (!branch || branch[channel] === undefined) return prev;
      const { [channel]: _, ...rest } = branch;
      const next = { ...prev };
      if (Object.keys(rest).length === 0) delete next[eventType];
      else next[eventType] = rest;
      return next;
    });
  }, []);

  const setChannel = useCallback(
    async (eventType: string, channel: PrefChannel, enabled: boolean) => {
      const key = `${eventType}:${channel}`;
      const gen = (saveGenerationRef.current[key] = (saveGenerationRef.current[key] ?? 0) + 1);

      setOptimisticByEvent((prev) => ({
        ...prev,
        [eventType]: { ...prev[eventType], [channel]: enabled },
      }));

      try {
        await upsertNotificationPreference({
          accountId,
          eventType,
          channel,
          enabled,
          frequency: enabled ? 'instant' : 'muted',
        });
        if (saveGenerationRef.current[key] !== gen) return;
        await load({ silent: true });
        if (saveGenerationRef.current[key] !== gen) return;
        clearOptimisticChannel(eventType, channel);
        toast.success('Saved');
      } catch (e) {
        if (saveGenerationRef.current[key] === gen) {
          clearOptimisticChannel(eventType, channel);
          toast.error(e instanceof Error ? e.message : 'Could not save');
        }
      }
    },
    [accountId, clearOptimisticChannel, load, toast]
  );

  const enableDeviceAlerts = async () => {
    if (Platform.OS !== 'web') {
      toast.warning('Device alerts can be turned on from Furnace in your desktop or phone browser.');
      return;
    }
    if (!getWebPushVapidPublicKey()) {
      toast.error(
        'This web build has no push key. Add EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY to Amplify (match Lambda public VAPID key) and redeploy.'
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
      await load({ silent: true });
      toast.success('This device can now show Furnace alerts.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setPushBusy(false);
    }
  };

  const headerRowMb = isMobile ? 'mb-3' : 'mb-4';

  return (
    <Card ref={accountNotificationsRef} variant={cardVariant} className={cardClassName ?? ''}>
      <View
        className={`flex-row items-center justify-between gap-3 border-b border-[#2A2A2A] pb-2 ${headerRowMb}`}
      >
        <Text className={`flex-1 min-w-0 pr-2 ${titleClassName}`} numberOfLines={2}>
          Notifications
        </Text>
        <Button
          variant="secondary"
          size="sm"
          className="flex-shrink-0"
          onPress={() => router.push('/notifications')}
        >
          View notifications
        </Button>
      </View>

      {Platform.OS === 'web' ? (
        <View className={`border-b border-[#2A2A2A] pb-4 ${headerRowMb}`}>
          <Text className="text-white text-sm font-instrument-medium mb-1">Device setup</Text>
          <Text className="text-gray-500 text-xs mb-3 leading-5">
            {subCount > 0
              ? 'This browser is registered for your user. Enable Device Push Notification per category below.'
              : 'Allow Furnace to send alerts on this browser so you can use Device Push Notification below.'}
          </Text>
          <Button size="sm" onPress={() => void enableDeviceAlerts()} disabled={pushBusy}>
            {pushBusy ? 'Working…' : subCount > 0 ? 'Update device permission' : 'Allow alerts on this device'}
          </Button>
        </View>
      ) : (
        <View className={`border-b border-[#2A2A2A] pb-4 ${headerRowMb}`}>
          <Text className="text-gray-500 text-xs leading-5">
            To allow device alerts, open Furnace in a web browser and use Account → Notifications there.
          </Text>
        </View>
      )}

      {loading ? (
        <View className="gap-3">
          <NotificationPrefSkeleton />
          <NotificationPrefSkeleton />
        </View>
      ) : (
        <View className="gap-3">
          {sortedCatalog.map((def) => {
            const inApp = effectiveChannelEnabled(prefs, def.id, 'in_app', true, optimisticByEvent);
            const device = effectiveChannelEnabled(prefs, def.id, 'web_push', false, optimisticByEvent);
            const DevicePushIcon = isMobile ? DevicePhoneMobileIcon : ComputerDesktopIcon;
            const iconMuted = '#A3A3A3';
            return (
              <Card key={def.id} variant="card">
                <Text
                  className={`text-white text-sm font-instrument-medium ${def.description ? '' : 'mb-3'}`}
                >
                  {def.title}
                </Text>
                {def.description ? (
                  <Text className="text-gray-500 text-xs mt-1 mb-3 leading-5">{def.description}</Text>
                ) : null}
                <View className="gap-4">
                  <View className="flex-row items-center justify-between py-2">
                    <View className="flex-row items-center flex-1 min-w-0 pr-3 gap-2">
                      <DevicePushIcon size={20} color={iconMuted} />
                      <Text className="text-gray-300 text-sm flex-1">Device Push Notification</Text>
                    </View>
                    <Toggle
                      value={device}
                      onValueChange={(v) => void setChannel(def.id, 'web_push', v)}
                    />
                  </View>
                  <View className="flex-row items-center justify-between py-2">
                    <View className="flex-row items-center flex-1 min-w-0 pr-3 gap-2">
                      <Squares2X2Icon size={20} color={iconMuted} />
                      <Text className="text-gray-300 text-sm flex-1">In App Notifications</Text>
                    </View>
                    <Toggle value={inApp} onValueChange={(v) => void setChannel(def.id, 'in_app', v)} />
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Card>
  );
}
