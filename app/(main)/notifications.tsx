import { useCallback, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import {
  PageLayout,
  DetailPageHeader,
  Breadcrumb,
  PageHeader,
  LAYOUT_BREAKPOINT,
} from '@/components/ui/layout';
import { Tabs } from '@/components/ui/tabs';
import { useSmoothLoading } from '@/components/ui/feedback';
import { NotificationsList } from '@/components/notifications/NotificationsList';
import { useNotifications } from '@/hooks/useNotifications';
import { buildInboxThreadHref, parseInboxNotificationUrl } from '@/lib/inbox/inboxRoutes';
import type {
  AppNotification,
  NotificationListFilter,
} from '@/lib/supabase/services/notifications';
const DESKTOP_CONTENT_MAX_WIDTH = 720;

const breadcrumbItems = [{ label: 'Settings', href: '/account' }, { label: 'Notifications' }];

const NOTIFICATION_TABS: { id: NotificationListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
];

export default function NotificationsPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const { account } = useAccount();
  const accountId = account?.id ?? null;

  const [listFilter, setListFilter] = useState<NotificationListFilter>('all');
  const { items, loading, error, refresh, markRead, markUnread } = useNotifications(
    accountId,
    listFilter
  );
  const showSkeleton = useSmoothLoading(loading);

  const handlePressNotification = useCallback(
    (n: AppNotification) => {
      if (!n.read_at) {
        void markRead(n.id);
      }
      const inboxLink = parseInboxNotificationUrl(n.action_url ?? '');
      if (inboxLink?.threadId) {
        router.push(buildInboxThreadHref(inboxLink.threadId) as Href);
        return;
      }
      const target = n.action_url?.startsWith('/') ? n.action_url : '/inbox';
      router.push(target as `/${string}`);
    },
    [router, markRead]
  );

  const handleMarkAsRead = useCallback(
    (n: AppNotification) => {
      void markRead(n.id);
    },
    [markRead]
  );

  const handleMarkAsUnread = useCallback(
    (n: AppNotification) => {
      void markUnread(n.id);
    },
    [markUnread]
  );

  const filterTabs =
    accountId ? (
      <View className={isMobile ? 'w-full' : ''}>
        <Tabs
          tabs={NOTIFICATION_TABS}
          activeTab={listFilter}
          onTabChange={(id) => setListFilter(id as NotificationListFilter)}
          layout={isMobile ? 'equal' : 'content'}
          marginBottom={16}
        />
      </View>
    ) : null;

  const body =
    !accountId ? (
      <Text className="text-gray-400 font-instrument text-sm">
        Select a workspace to see notifications.
      </Text>
    ) : (
      <NotificationsList
        isMobile={isMobile}
        listFilter={listFilter}
        items={items}
        loading={loading || showSkeleton}
        error={error}
        onRetry={() => void refresh()}
        onPressNotification={(n) => handlePressNotification(n)}
        onMarkAsRead={(n) => handleMarkAsRead(n)}
        onMarkAsUnread={(n) => handleMarkAsUnread(n)}
      />
    );

  return (
    <PageLayout mobileLayout="scrollable">
      {isMobile ? (
        <>
          <DetailPageHeader
            breadcrumbItems={breadcrumbItems}
            backHref="/account"
            title="Notifications"
            subtitle="Activity for this workspace"
          />
          {filterTabs}
          {body}
        </>
      ) : (
        <>
          <View className="mb-4">
            <Breadcrumb items={breadcrumbItems} />
          </View>
          <PageHeader title="Notifications" subtitle="Activity for this workspace" />
          <View style={{ maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }}>
            {filterTabs}
            {body}
          </View>
        </>
      )}
    </PageLayout>
  );
}
