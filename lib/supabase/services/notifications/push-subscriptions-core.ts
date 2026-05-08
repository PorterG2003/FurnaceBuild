export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type AuthenticatedClient = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: Error | null;
    }>;
  };
  from(table: 'push_subscriptions'): {
    upsert(
      values: {
        user_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        user_agent: string | null;
        last_seen_at: string;
        revoked_at: null;
      },
      options: { onConflict: string }
    ): Promise<{ error: { message: string } | null }>;
    select(columns: string): {
      eq(column: 'user_id', value: string): {
        is(column: 'revoked_at', value: null): Promise<{
          data: { endpoint: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(values: { revoked_at: string }): {
      eq(column: 'user_id', value: string): {
        eq(column: 'endpoint', value: string): Promise<{ error: { message: string } | null }>;
      };
    };
  };
};

async function getAuthenticatedUserId(client: AuthenticatedClient): Promise<string> {
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  return userData.user.id;
}

export async function upsertPushSubscriptionWithClient(
  client: AuthenticatedClient,
  keys: PushSubscriptionKeys,
  userAgent?: string | null
): Promise<void> {
  const userId = await getAuthenticatedUserId(client);

  const { error } = await client.from('push_subscriptions').upsert(
    {
      user_id: userId,
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

export async function revokePushSubscriptionByEndpointWithClient(
  client: AuthenticatedClient,
  endpoint: string
): Promise<void> {
  const userId = await getAuthenticatedUserId(client);

  const { error } = await client
    .from('push_subscriptions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('endpoint', endpoint);

  if (error) throw new Error(`Failed to revoke subscription: ${error.message}`);
}

export async function listActivePushSubscriptionsWithClient(
  client: AuthenticatedClient
): Promise<{ endpoint: string }[]> {
  const userId = await getAuthenticatedUserId(client);

  const { data, error } = await client
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error) return [];
  return data ?? [];
}
