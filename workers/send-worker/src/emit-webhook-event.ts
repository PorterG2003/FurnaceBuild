import type { SupabaseClient } from '@supabase/supabase-js';
import { persistWebhookEvent } from '@furnace/webhooks-lib';

export async function emitWebhookEvent(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    campaignId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<void> {
  await persistWebhookEvent(supabase, params, { failSilent: true });
}
