import type { SupabaseClient } from '@supabase/supabase-js';
import { persistWebhookEvent } from '../../../lib/client-api/webhooks/persistWebhookEvent.js';

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
