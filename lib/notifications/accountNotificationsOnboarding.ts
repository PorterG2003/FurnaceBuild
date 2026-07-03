import { Platform } from 'react-native';
import type { PrefRow } from '@/lib/supabase/services/notifications';

const REPLY_EVENT = 'email.received';

type PrefChannel = 'in_app' | 'web_push';

function channelEnabled(
  prefs: PrefRow[],
  eventType: string,
  channel: PrefChannel,
  defaultOn: boolean,
  optimisticByEvent?: Record<string, Partial<Record<PrefChannel, boolean>>>,
): boolean {
  const optimistic = optimisticByEvent?.[eventType]?.[channel];
  if (optimistic !== undefined) return optimistic;
  const row = prefs.find((p) => p.event_type === eventType && p.channel === channel);
  if (!row) return defaultOn;
  return row.enabled && row.frequency !== 'muted';
}

/** True once reply alerts are configured enough to leave the account onboarding step. */
export function accountNotificationsOnboardingComplete(
  prefs: PrefRow[],
  subCount: number,
  optimisticByEvent?: Record<string, Partial<Record<PrefChannel, boolean>>>,
): boolean {
  const inAppOn = channelEnabled(prefs, REPLY_EVENT, 'in_app', true, optimisticByEvent);
  if (Platform.OS !== 'web') {
    return inAppOn;
  }
  const devicePushOn = channelEnabled(prefs, REPLY_EVENT, 'web_push', false, optimisticByEvent);
  return inAppOn && devicePushOn && subCount > 0;
}
