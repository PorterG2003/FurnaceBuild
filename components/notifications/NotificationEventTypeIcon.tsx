import type { ComponentType } from 'react';
import { BellIcon, CodeBracketIcon, EnvelopeIcon } from 'react-native-heroicons/outline';

/**
 * Icons per `notification_events.event_type` (see `lib/notifications/notification-types.ts`).
 * When adding a product type: add catalog + DB producers, then an entry here.
 */
type HeroOutlineIcon = ComponentType<{ size?: number; color?: string }>;

interface EventTypeVisual {
  Icon: HeroOutlineIcon;
  /** Stroke/fill color for the outline icon (hex, readable on #121212). */
  iconColor: string;
}

/** Default + per-type tints; extend when adding `event_type`s. */
const NOTIFICATION_ICON_COLORS = {
  default: '#F3440D',
  emailReceived: '#38BDF8',
  testNotification: '#C084FC',
} as const;

const DEFAULT_VISUAL: EventTypeVisual = {
  Icon: BellIcon,
  iconColor: NOTIFICATION_ICON_COLORS.default,
};

const VISUAL_BY_EVENT_TYPE: Record<string, EventTypeVisual> = {
  'email.received': {
    Icon: EnvelopeIcon,
    iconColor: NOTIFICATION_ICON_COLORS.emailReceived,
  },
  /** RPC `create_test_notification` and dev-only flows */
  'test.notification': {
    Icon: CodeBracketIcon,
    iconColor: NOTIFICATION_ICON_COLORS.testNotification,
  },
};

export function getNotificationEventTypeVisual(eventType: string | null | undefined): EventTypeVisual {
  if (eventType && VISUAL_BY_EVENT_TYPE[eventType]) {
    return VISUAL_BY_EVENT_TYPE[eventType]!;
  }
  return DEFAULT_VISUAL;
}

export function NotificationEventTypeIcon({
  eventType,
  size = 20,
}: {
  eventType: string | null | undefined;
  size?: number;
}) {
  const { Icon, iconColor } = getNotificationEventTypeVisual(eventType);
  return <Icon size={size} color={iconColor} />;
}
