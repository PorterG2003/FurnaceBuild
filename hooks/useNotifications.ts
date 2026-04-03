import { useCallback, useEffect, useState } from 'react';
import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  markNotificationUnread,
  type AppNotification,
  type NotificationListFilter,
} from '@/lib/supabase/services/notifications';

export function useNotifications(
  accountId: string | null,
  listFilter: NotificationListFilter = 'all'
) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setUnreadCount(0);
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [count, list] = await Promise.all([
        getUnreadNotificationCount(accountId),
        listNotifications(accountId, { limit: 30, filter: listFilter }),
      ]);
      setUnreadCount(count);
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [accountId, listFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      let wasUnread = false;
      setItems((prev) => {
        const n = prev.find((x) => x.id === id);
        if (!n || n.read_at != null) return prev;
        wasUnread = true;
        if (listFilter === 'unread') {
          return prev.filter((x) => x.id !== id);
        }
        return prev.map((x) =>
          x.id === id ? { ...x, read_at: new Date().toISOString(), status: 'read' } : x
        );
      });
      if (!wasUnread) return;
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(id);
      } catch {
        void refresh();
      }
    },
    [refresh, listFilter]
  );

  const markUnread = useCallback(
    async (id: string) => {
      let wasRead = false;
      setItems((prev) => {
        const n = prev.find((x) => x.id === id);
        if (!n || n.read_at == null) return prev;
        wasRead = true;
        if (listFilter === 'read') {
          return prev.filter((x) => x.id !== id);
        }
        return prev.map((x) =>
          x.id === id ? { ...x, read_at: null, status: 'unread' } : x
        );
      });
      if (!wasRead) return;
      setUnreadCount((c) => c + 1);
      try {
        await markNotificationUnread(id);
      } catch {
        void refresh();
      }
    },
    [refresh, listFilter]
  );

  return {
    unreadCount,
    items,
    loading,
    error,
    refresh,
    markRead,
    markUnread,
  };
}
