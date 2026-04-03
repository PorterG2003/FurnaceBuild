/**
 * User-facing notification categories. `id` is stored as notification_preferences.event_type
 * and must match producers (e.g. inbox worker → email.received).
 *
 * List/card icons: add a matching entry in `components/notifications/NotificationEventTypeIcon.tsx`.
 */
export interface NotificationTypeDefinition {
  id: string;
  title: string;
  description?: string;
  /** Lower sorts first */
  order: number;
}

export const NOTIFICATION_TYPE_CATALOG: NotificationTypeDefinition[] = [
  {
    id: 'email.received',
    order: 10,
    title: 'Email Replies',
  },
];

export function getNotificationTypeById(id: string): NotificationTypeDefinition | undefined {
  return NOTIFICATION_TYPE_CATALOG.find((t) => t.id === id);
}
