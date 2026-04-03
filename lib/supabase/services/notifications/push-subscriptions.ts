import { supabase } from '../../client';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function upsertPushSubscription(
  accountId: string,
  keys: PushSubscriptionKeys,
  userAgent?: string | null
): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  const userId = userData.user.id;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      account_id: accountId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent ?? null,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: 'user_id,endpoint' }
  );

  if (error) throw new Error(`Failed to save push subscription: ${error.message}`);
}

export async function revokePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('push_subscriptions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userData.user.id)
    .eq('endpoint', endpoint);

  if (error) throw new Error(`Failed to revoke subscription: ${error.message}`);
}

export async function listActivePushSubscriptions(accountId: string): Promise<{ endpoint: string }[]> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return [];
  const userId = userData.user.id;

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .is('revoked_at', null);

  if (error) return [];
  return (data ?? []) as { endpoint: string }[];
}
