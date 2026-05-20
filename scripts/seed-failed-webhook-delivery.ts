/**
 * Inserts a failed webhook delivery for QA on the account settings UI.
 *
 * Usage (from repo root, loads .env.local):
 *   npx tsx scripts/seed-failed-webhook-delivery.ts
 */
import { loadSeedEnv } from './seed/env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  loadSeedEnv();
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accountId = process.env.SEED_ACCOUNT_ID;
  if (!url || !key || !accountId) {
    throw new Error('Need SUPABASE_URL and SUPABASE_SECRET_KEY and SEED_ACCOUNT_ID in .env.local');
  }

  const supabase = createClient(url, key);

  const { data: account } = await supabase
    .from('accounts')
    .select('webhook_url')
    .eq('id', accountId)
    .single();
  const endpoint = account?.webhook_url?.trim() || 'https://postman-echo.com/post';

  const dedupeKey = `qa.failed-delivery.${Date.now()}`;
  const { data: event, error: eventErr } = await supabase
    .from('webhook_events')
    .insert({
      account_id: accountId,
      campaign_id: null,
      event_type: 'lead.created',
      payload: {
        email: 'qa-failed-delivery@example.com',
        lead_id: '00000000-0000-4000-8000-000000000001',
        campaign_id: null,
        qa: true,
      },
      dedupe_key: dedupeKey,
    })
    .select('id')
    .single();

  if (eventErr || !event) {
    throw new Error(`webhook_events insert failed: ${eventErr?.message}`);
  }

  const { data: delivery, error: deliveryErr } = await supabase
    .from('webhook_deliveries')
    .insert({
      webhook_event_id: event.id,
      account_id: accountId,
      campaign_id: null,
      endpoint_url: endpoint,
      event_type: 'lead.created',
      status: 'failed',
      attempt_count: 3,
      request_body: { type: 'lead.created', data: { email: 'qa-failed-delivery@example.com' } },
      response_status: 502,
      response_body: 'Bad Gateway',
      error: 'HTTP 502',
      last_attempt_at: new Date().toISOString(),
      delivered_at: null,
    })
    .select('id, status, error, created_at')
    .single();

  if (deliveryErr || !delivery) {
    throw new Error(`webhook_deliveries insert failed: ${deliveryErr?.message}`);
  }

  console.log('Created failed webhook delivery for QA:');
  console.log('  delivery_id:', delivery.id);
  console.log('  event_id:', event.id);
  console.log('  endpoint:', endpoint);
  console.log('');
  console.log('Refresh Account → Webhooks in the app to see it under Recent failed deliveries.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
