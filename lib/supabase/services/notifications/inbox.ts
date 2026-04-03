import { supabase } from '../../client';
import type { Database } from '../../types/database';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

/** In-app notification with `event_type` from joined `notification_events` (not a DB column on `notifications`). */
export type AppNotification = NotificationRow & { event_type: string | null };

type ListNotificationsRawRow = NotificationRow & {
  notification_events: { event_type: string } | null;
};

function mapNotificationRow(row: ListNotificationsRawRow): AppNotification {
  const { notification_events: ev, ...base } = row;
  return {
    ...base,
    event_type: ev?.event_type ?? null,
  };
}

export type NotificationListFilter = 'all' | 'unread' | 'read';

export async function listNotifications(
  accountId: string,
  options?: { limit?: number; filter?: NotificationListFilter; unreadOnly?: boolean }
): Promise<AppNotification[]> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  const userId = userData.user.id;
  const limit = options?.limit ?? 50;

  const filter: NotificationListFilter =
    options?.filter ?? (options?.unreadOnly ? 'unread' : 'all');

  let q = supabase
    .from('notifications')
    .select(
      `
      *,
      notification_events (
        event_type
      )
    `
    )
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter === 'unread') {
    q = q.is('read_at', null);
  } else if (filter === 'read') {
    q = q.not('read_at', 'is', null);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list notifications: ${error.message}`);
  return (data ?? []).map((row) => mapNotificationRow(row as ListNotificationsRawRow));
}

export async function getUnreadNotificationCount(accountId: string): Promise<number> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return 0;
  const userId = userData.user.id;

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .is('read_at', null)
    .is('archived_at', null);

  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('notifications')
    .update({
      read_at: new Date().toISOString(),
      status: 'read',
    })
    .eq('id', notificationId)
    .eq('user_id', userData.user.id);

  if (error) throw new Error(`Failed to mark read: ${error.message}`);
}

export async function markNotificationUnread(notificationId: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('notifications')
    .update({
      read_at: null,
      status: 'unread',
    })
    .eq('id', notificationId)
    .eq('user_id', userData.user.id);

  if (error) throw new Error(`Failed to mark unread: ${error.message}`);
}

export async function markAllNotificationsRead(accountId: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  const userId = userData.user.id;

  const { error } = await supabase
    .from('notifications')
    .update({
      read_at: new Date().toISOString(),
      status: 'read',
    })
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .is('read_at', null);

  if (error) throw new Error(`Failed to mark all read: ${error.message}`);
}
