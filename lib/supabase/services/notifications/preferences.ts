import { supabase } from '../../client';
import type { Database } from '../../types/database';

export type NotificationChannel = 'in_app' | 'web_push';
/** Matches notification_preferences.event_type and catalog ids in lib/notifications/notification-types.ts */
export type NotificationEventType = string;

export type PrefRow = Database['public']['Tables']['notification_preferences']['Row'];

export async function getNotificationPreferences(
  accountId: string
): Promise<PrefRow[]> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  const userId = userData.user.id;

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId);

  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);
  return (data ?? []) as PrefRow[];
}

export async function upsertNotificationPreference(params: {
  accountId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
  frequency?: 'instant' | 'digest' | 'muted';
}): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  const userId = userData.user.id;

  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      account_id: params.accountId,
      event_type: params.eventType,
      channel: params.channel,
      enabled: params.enabled,
      frequency: params.frequency ?? 'instant',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,account_id,event_type,channel' }
  );

  if (error) throw new Error(`Failed to save preference: ${error.message}`);
}
