/**
 * Live E2E: uses CLIENT_API_KEY env and SEED_ACCOUNT_ID from .env.local.
 * Optional: CAMPAIGN_ID, CLIENT_API_LIVE_WEBHOOK_URL (for delivery check hint).
 *
 * Usage:
 *   CLIENT_API_KEY='f_...' npx tsx scripts/run-live-e2e-with-key.ts
 */
import crypto from 'node:crypto';
import { loadSeedEnv } from './seed/env.js';
import { createClient } from '@supabase/supabase-js';

const API_KEY = process.env.CLIENT_API_KEY?.trim();
const BASE_URL = (process.env.CLIENT_API_LIVE_BASE_URL || 'https://api-dev.getfurnace.io').replace(/\/$/, '');
const POLL_MS = 60_000;
const INTERVAL_MS = 2000;

async function request<T>(path: string, init: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`${res.status} ${path}: ${text.slice(0, 500)}`);
  }
  return { status: res.status, body };
}

async function poll<T>(fn: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + POLL_MS;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  throw new Error('Timed out waiting for webhook pipeline');
}

async function main() {
  if (!API_KEY) {
    console.error('Set CLIENT_API_KEY');
    process.exit(1);
  }
  loadSeedEnv();
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL/key in .env.local');

  const supabase = createClient(url, key);
  const accountId = process.env.SEED_ACCOUNT_ID;
  if (!accountId) throw new Error('Missing SEED_ACCOUNT_ID');

  const { data: acct } = await supabase
    .from('accounts')
    .select('webhook_url, webhook_enabled_events')
    .eq('id', accountId)
    .single();
  console.log('[e2e] account webhook:', acct);

  let campaignId = process.env.CAMPAIGN_ID?.trim();
  if (!campaignId) {
    const { data: camps } = await supabase
      .from('campaigns')
      .select('id, name, status')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1);
    campaignId = camps?.[0]?.id;
    if (!campaignId) {
      const { data: anyCamp } = await supabase
        .from('campaigns')
        .select('id, name, status')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      campaignId = anyCamp?.[0]?.id;
    }
  }
  if (!campaignId) throw new Error('No campaign found for account');
  console.log('[e2e] campaign:', campaignId);

  const health = await request<{ status: string; db: string }>('/health', { method: 'GET' });
  if (health.status !== 200 || health.body.status !== 'ok') {
    throw new Error(`Health failed: ${JSON.stringify(health.body)}`);
  }
  console.log('[e2e] health OK');

  const ns = `live-ui-${Date.now().toString(36)}`;
  const leadEmail = `${ns}@example.com`;
  const idem = `${ns}-lead`;

  const leadRes = await request<{ data: { id: string; email: string }; created: boolean }>(
    `/v1/campaigns/${campaignId}/leads`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({ email: leadEmail, first_name: 'E2E', last_name: 'Live' }),
    },
  );
  if (leadRes.status !== 201) {
    throw new Error(`Lead create ${leadRes.status}: ${JSON.stringify(leadRes.body)}`);
  }
  console.log('[e2e] lead created:', leadRes.body.data.id, leadEmail);

  const event = await poll(async () => {
    const { data, error } = await supabase
      .from('webhook_events')
      .select('id, event_type, payload, created_at')
      .eq('account_id', accountId)
      .eq('campaign_id', campaignId)
      .eq('event_type', 'lead.created')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const p = data?.payload as { email?: string } | null;
    return p?.email === leadEmail ? data : null;
  });
  console.log('[e2e] webhook_event:', event.id);

  const delivery = await poll(async () => {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select('id, status, attempt_count, response_status, response_body, error, endpoint_url')
      .eq('webhook_event_id', event.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status === 'sending') return null;
    return data;
  });

  console.log('[e2e] webhook_delivery:', delivery);
  if (delivery.status !== 'delivered') {
    throw new Error(`Delivery not delivered: ${delivery.status} ${delivery.error ?? ''}`);
  }
  console.log('[e2e] SUCCESS — API key auth, lead create, event, delivery all OK');
  console.log('[e2e] Check your webhook endpoint for POST with lead.created:', acct?.webhook_url);
}

main().catch((e) => {
  console.error('[e2e] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
