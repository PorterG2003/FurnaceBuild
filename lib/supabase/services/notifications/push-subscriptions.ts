import { supabase } from '../../client';
import {
  type PushSubscriptionKeys,
  listActivePushSubscriptionsWithClient,
  revokePushSubscriptionByEndpointWithClient,
  upsertPushSubscriptionWithClient,
} from './push-subscriptions-core';

export async function upsertPushSubscription(
  keys: PushSubscriptionKeys,
  userAgent?: string | null
): Promise<void> {
  await upsertPushSubscriptionWithClient(supabase as any, keys, userAgent);
}

export async function revokePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await revokePushSubscriptionByEndpointWithClient(supabase as any, endpoint);
}

export async function listActivePushSubscriptions(): Promise<{ endpoint: string }[]> {
  return listActivePushSubscriptionsWithClient(supabase as any);
}
