import { useEffect, useRef } from 'react';
import { useAccount } from '@/contexts/AccountContext';
import { useToast } from '@/components/ui/feedback';
import { supabase } from '@/lib/supabase/client';

function buildToastMessage(title: string, body: string | null, maxBody = 100): string {
  const t = title?.trim() || 'Notification';
  if (!body?.trim()) return t;
  const b = body.trim();
  const shortened = b.length > maxBody ? `${b.slice(0, maxBody)}…` : b;
  return `${t} — ${shortened}`;
}

/**
 * Subscribes to new `notifications` rows for the current user and shows a neutral toast.
 * Must render under ToastProvider and AccountProvider.
 */
export function NotificationToastSubscriber() {
  const { user, account } = useAccount();
  const { toast } = useToast();
  const showNotificationRef = useRef(toast.notification);
  showNotificationRef.current = toast.notification;
  const ignoreInsertsBeforeMs = useRef<number | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      return;
    }

    const channelName = `notifications-toast:${userId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            title?: string;
            body?: string | null;
            created_at?: string;
            account_id?: string;
          };
          if (account?.id && row.account_id && row.account_id !== account.id) {
            return;
          }
          if (ignoreInsertsBeforeMs.current != null && row.created_at) {
            const createdMs = new Date(row.created_at).getTime();
            if (!Number.isNaN(createdMs) && createdMs < ignoreInsertsBeforeMs.current) {
              return;
            }
          }
          showNotificationRef.current(buildToastMessage(row.title ?? '', row.body ?? null));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ignoreInsertsBeforeMs.current = Date.now() - 1500;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, account?.id]);

  return null;
}
