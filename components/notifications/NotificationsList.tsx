import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { EllipsisVerticalIcon } from 'react-native-heroicons/outline';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { SendersCardListSkeleton } from '@/components/skeletons';
import type {
  AppNotification,
  NotificationListFilter,
} from '@/lib/supabase/services/notifications';
import { NotificationEventTypeIcon } from '@/components/notifications/NotificationEventTypeIcon';
import { NotificationItemActionsSheet } from '@/components/notifications/NotificationItemActionsSheet';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function resolveNotificationStatus(n: AppNotification): 'unread' | 'read' | 'archived' {
  if (n.archived_at != null) return 'archived';
  if (n.read_at == null) return 'unread';
  return 'read';
}

function NotificationStatusPill({ status }: { status: 'unread' | 'read' | 'archived' }) {
  if (status === 'unread') {
    return (
      <View className="px-2 py-1 rounded-md flex-shrink-0 bg-[rgba(243,68,13,0.15)] border border-brand-orange/25">
        <Text className="text-xs font-instrument-medium text-brand-orange">Unread</Text>
      </View>
    );
  }
  if (status === 'archived') {
    return (
      <View className="px-2 py-1 rounded-md flex-shrink-0 bg-[#1A1A1A] border border-[#3A3A3A]">
        <Text className="text-xs font-instrument-medium text-gray-500">Archived</Text>
      </View>
    );
  }
  return (
    <View className="px-2 py-1 rounded-md flex-shrink-0 bg-[#2A2A2A] border border-[#3A3A3A]">
      <Text className="text-xs font-instrument-medium text-gray-400">Read</Text>
    </View>
  );
}

function NotificationCardBody({
  n,
  status,
}: {
  n: AppNotification;
  status: 'unread' | 'read' | 'archived';
}) {
  return (
    <>
      <View className="flex-row items-start gap-2">
        <View className="pt-0.5 flex-shrink-0">
          <NotificationEventTypeIcon eventType={n.event_type} />
        </View>
        <View className="flex-1 min-w-0 flex-row flex-wrap items-center gap-2">
          <Text
            className="text-white font-instrument-medium text-base flex-shrink"
            numberOfLines={2}
          >
            {n.title?.trim() || 'Notification'}
          </Text>
          <NotificationStatusPill status={status} />
        </View>
      </View>
      {n.body ? (
        <Text className="text-gray-400 font-instrument text-sm mt-2 w-full" numberOfLines={3}>
          {n.body}
        </Text>
      ) : null}
      <Text className="text-gray-500 font-instrument text-xs mt-2">{formatTime(n.created_at)}</Text>
    </>
  );
}

function emptyCopy(filter: NotificationListFilter): { title: string; description: string } {
  if (filter === 'unread') {
    return {
      title: 'No unread notifications',
      description: 'You are all caught up.',
    };
  }
  if (filter === 'read') {
    return {
      title: 'No read notifications',
      description: 'Read notifications will appear here.',
    };
  }
  return {
    title: 'No notifications yet',
    description: 'When something needs your attention, it will show up here.',
  };
}

export interface NotificationsListProps {
  isMobile?: boolean;
  listFilter?: NotificationListFilter;
  items: AppNotification[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPressNotification: (n: AppNotification) => void;
  onMarkAsRead?: (n: AppNotification) => void;
  onMarkAsUnread?: (n: AppNotification) => void;
}

export function NotificationsList({
  isMobile = false,
  listFilter = 'all',
  items,
  loading,
  error,
  onRetry,
  onPressNotification,
  onMarkAsRead,
  onMarkAsUnread,
}: NotificationsListProps) {
  const [menuNotification, setMenuNotification] = useState<AppNotification | null>(null);

  useEffect(() => {
    if (!isMobile && menuNotification) {
      setMenuNotification(null);
    }
  }, [isMobile, menuNotification]);

  useEffect(() => {
    if (menuNotification == null) return;
    const fresh = items.find((x) => x.id === menuNotification.id);
    if (fresh == null) {
      setMenuNotification(null);
    } else if (fresh !== menuNotification) {
      setMenuNotification(fresh);
    }
  }, [items, menuNotification]);

  if (loading) {
    return <SendersCardListSkeleton />;
  }

  if (error) {
    return (
      <Alert variant="error" message={error} actionText="Try again" onAction={onRetry} />
    );
  }

  if (items.length === 0) {
    const { title, description } = emptyCopy(listFilter);
    return <EmptyState title={title} description={description} />;
  }

  return (
    <View>
      {items.map((n) => {
        const status = resolveNotificationStatus(n);
        const unread = status === 'unread';

        if (isMobile) {
          return (
            <Card key={n.id} variant="card" className="mb-4">
              <View className="flex-row items-start gap-1">
                <Pressable
                  className="flex-1 min-w-0"
                  onPress={() => onPressNotification(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open notification: ${n.title?.trim() || 'Notification'}`}
                >
                  <NotificationCardBody n={n} status={status} />
                </Pressable>
                <IconButton
                  icon={EllipsisVerticalIcon}
                  variant="overflow"
                  onPress={() => setMenuNotification(n)}
                  hitSlop={8}
                  accessibilityLabel="Notification actions"
                  className="flex-shrink-0 mt-0.5"
                />
              </View>
            </Card>
          );
        }

        const actionButton =
          unread && onMarkAsRead ? (
            <Button
              variant="secondary"
              size="sm"
              onPress={() => onMarkAsRead(n)}
              accessibilityLabel="Mark this notification as read"
            >
              Mark as read
            </Button>
          ) : !unread && onMarkAsUnread ? (
            <Button
              variant="secondary"
              size="sm"
              onPress={() => onMarkAsUnread(n)}
              accessibilityLabel="Mark this notification as unread"
            >
              Mark as unread
            </Button>
          ) : null;

        return (
          <Card key={n.id} variant="card" className="mb-4">
            <View className="flex-row items-start gap-2">
              <Pressable
                className="flex-1 min-w-0"
                onPress={() => onPressNotification(n)}
                accessibilityRole="button"
                accessibilityLabel={`Open notification: ${n.title?.trim() || 'Notification'}`}
              >
                <NotificationCardBody n={n} status={status} />
              </Pressable>
              {actionButton ? (
                <View className="flex-shrink-0 pt-0.5">{actionButton}</View>
              ) : null}
            </View>
          </Card>
        );
      })}
      {isMobile && (onMarkAsRead || onMarkAsUnread) ? (
        <NotificationItemActionsSheet
          visible={menuNotification != null}
          notification={menuNotification}
          onClose={() => setMenuNotification(null)}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
        />
      ) : null}
    </View>
  );
}
