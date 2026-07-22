import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadSeedEnv } from './seed/env.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from '../lib/test/client-api/harness.js';
import { linearFlowForApi } from '../lib/test/client-api/flowApiHelpers.js';

type JsonObject = Record<string, unknown>;

type DeliveryRow = {
  id: string;
  status: string;
  attempt_count: number | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
};

const DEFAULT_WEBHOOK_URL = 'https://postman-echo.com/post';
const POLL_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2_000;

function resolveClientApiBaseUrl(): string {
  const explicit = process.env.CLIENT_API_LIVE_BASE_URL?.trim() || process.env.CLIENT_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const domain = process.env.CLIENT_API_DOMAIN_NAME?.trim();
  if (domain) {
    return `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  return 'https://api-dev.getfurnace.io';
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{
  status: number;
  body: T;
}> {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON response from ${String(input)}, got: ${text.slice(0, 400)}`);
  }
  return { status: response.status, body };
}

async function poll<T>(label: string, fn: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function cleanupHarnessIdentity(
  harness: ClientApiDbHarness,
  createdAccountId: string,
  createdUserId: string,
): Promise<void> {
  const supabase = harness.supabase;

  await supabase.from('account_users').delete().eq('account_id', createdAccountId).eq('user_id', createdUserId);
  await supabase.from('accounts').delete().eq('id', createdAccountId);
  await supabase.from('users').delete().eq('id', createdUserId);
}

async function main() {
  loadSeedEnv();

  if (!process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!process.env.SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
  }

  const createdAccountId = crypto.randomUUID();
  const createdUserId = crypto.randomUUID();
  process.env.CAMPAIGN_TEST_ACCOUNT_ID = createdAccountId;
  process.env.CAMPAIGN_TEST_OWNER_USER_ID = createdUserId;

  const baseUrl = resolveClientApiBaseUrl();
  const webhookUrl = process.env.CLIENT_API_LIVE_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL;
  const namespace = createClientApiTestNamespace('live');
  const harness = new ClientApiDbHarness({ namespace });

  console.log(`[live-client-api] base URL: ${baseUrl}`);
  console.log(`[live-client-api] webhook URL: ${webhookUrl}`);
  console.log(`[live-client-api] namespace: ${namespace}`);

  try {
    const health = await requestJson<{ status: string; db: string }>(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.db, 'ok');
    console.log('[live-client-api] health check passed');

    const openapi = await requestJson<{
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    }>(`${baseUrl}/openapi.json`);
    assert.equal(openapi.status, 200);
    assert.equal(openapi.body.info.title, 'Furnace Client API');
    assert.ok(!('/documentation/changelog' in openapi.body.paths));
    assert.ok('/v1/campaigns' in openapi.body.paths);
    console.log('[live-client-api] openapi contract check passed');

    const docsHome = await fetch(`${baseUrl}/docs/`);
    const docsHtml = await docsHome.text();
    assert.equal(docsHome.status, 200);
    assert.match(docsHtml, /Client API/i);
    assert.doesNotMatch(docsHtml, /github\.com\/getfurnace\/furnace/i);
    console.log('[live-client-api] docs site check passed');

    const quickstartDoc = await fetch(`${baseUrl}/docs/guides/quickstart/`);
    const quickstartHtml = await quickstartDoc.text();
    assert.equal(quickstartDoc.status, 200);
    assert.match(quickstartHtml, /\/v1\/mailboxes/);
    console.log('[live-client-api] quickstart guide check passed');

    const campaignSetupDoc = await fetch(`${baseUrl}/docs/guides/campaign-setup/`);
    const campaignSetupHtml = await campaignSetupDoc.text();
    assert.equal(campaignSetupDoc.status, 200);
    assert.match(campaignSetupHtml, /\/v1\/campaigns\/\{id\}\/flow|\/v1\/campaigns\/[0-9a-f-]+\/flow/i);
    console.log('[live-client-api] campaign setup guide check passed');

    const referenceDoc = await fetch(`${baseUrl}/docs/reference/`);
    const referenceHtml = await referenceDoc.text();
    assert.equal(referenceDoc.status, 200);
    assert.match(referenceHtml, /API Reference|Furnace Client API|OpenAPI/i);
    console.log('[live-client-api] api reference check passed');

    const llmsTxt = await fetch(`${baseUrl}/llms.txt`);
    const llmsBody = await llmsTxt.text();
    assert.equal(llmsTxt.status, 200);
    assert.match(llmsBody, /LLM index/i);
    assert.match(llmsBody, /guides\/quickstart/);
    assert.match(llmsBody, /campaign-setup/);
    console.log('[live-client-api] llms.txt check passed');

    const apiKey = await harness.createApiKey('live-smoke');
    console.log(`[live-client-api] created API key ${apiKey.id}`);

    const draftGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Live Flow Smoke',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    console.log(`[live-client-api] seeded draft campaign ${draftGraph.campaignId}`);

    const flowDryRun = await requestJson<{ data: { allowed: boolean } }>(
      `${baseUrl}/v1/campaigns/${draftGraph.campaignId}/flow?dry_run=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(linearFlowForApi()),
      },
    );
    if (flowDryRun.status !== 200) {
      throw new Error(
        `Flow dry run failed with ${flowDryRun.status}: ${JSON.stringify(flowDryRun.body)}`,
      );
    }
    assert.equal(flowDryRun.body.data.allowed, true);
    console.log('[live-client-api] flow dry run passed');

    const flowRevision = await requestJson<{ data: { flow_revision: string } }>(
      `${baseUrl}/v1/campaigns/${draftGraph.campaignId}/flow`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.secret}` },
      },
    );
    assert.equal(flowRevision.status, 200);
    const revision = flowRevision.body.data.flow_revision;
    assert.equal(typeof revision, 'string');
    console.log('[live-client-api] flow revision read passed');

    const flowSave = await requestJson<{ data: { flow_revision: string } }>(
      `${baseUrl}/v1/campaigns/${draftGraph.campaignId}/flow`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.secret}`,
          'Content-Type': 'application/json',
          'If-Match': revision,
        },
        body: JSON.stringify(linearFlowForApi()),
      },
    );
    if (flowSave.status !== 200) {
      throw new Error(
        `Flow save failed with ${flowSave.status}: ${JSON.stringify(flowSave.body)}`,
      );
    }
    assert.notEqual(flowSave.body.data.flow_revision, revision);
    console.log('[live-client-api] flow save with If-Match passed');

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Live Smoke',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    console.log(`[live-client-api] seeded campaign ${graph.campaignId}`);


    const signingSecret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`;
    const { error: webhookConfigError } = await harness.supabase
      .from('accounts')
      .update({
        webhook_url: webhookUrl,
        webhook_signing_secret: signingSecret,
        webhook_enabled_events: ['lead.created'],
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', harness.accountId);
    if (webhookConfigError) {
      throw new Error(`Failed to configure test webhook: ${webhookConfigError.message}`);
    }
    console.log('[live-client-api] configured account webhook');

    const leadEmail = `${namespace}@example.com`;
    const leadResponse = await requestJson<{ data: { id: string; email: string }; created: boolean }>(
      `${baseUrl}/v1/campaigns/${graph.campaignId}/leads`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.secret}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${namespace}-lead-create`,
        },
        body: JSON.stringify({
          email: leadEmail,
          first_name: 'Live',
          last_name: 'Smoke',
        }),
      },
    );
    if (leadResponse.status !== 201) {
      throw new Error(
        `Lead create failed with ${leadResponse.status}: ${JSON.stringify(leadResponse.body)}`,
      );
    }
    assert.equal(leadResponse.body.created, true);
    assert.equal(leadResponse.body.data.email, leadEmail);
    console.log(`[live-client-api] created lead ${leadResponse.body.data.id}`);

    const eventRow = await poll(`${namespace} webhook event`, async () => {
      const { data, error } = await harness.supabase
        .from('webhook_events')
        .select('id, event_type, payload')
        .eq('account_id', harness.accountId)
        .eq('campaign_id', graph.campaignId)
        .eq('event_type', 'lead.created')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to read webhook event: ${error.message}`);
      }
      const payloadEmail = (data?.payload as JsonObject | null)?.email;
      return payloadEmail === leadEmail ? data : null;
    });
    console.log(`[live-client-api] observed webhook event ${eventRow.id}`);

    const deliveryRow = await poll<DeliveryRow>('webhook delivery', async () => {
      const { data, error } = await harness.supabase
        .from('webhook_deliveries')
        .select('id, status, attempt_count, response_status, response_body, error')
        .eq('webhook_event_id', eventRow.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to read webhook delivery: ${error.message}`);
      }
      if (!data) {
        return null;
      }
      if (data.status === 'sending') {
        return null;
      }
      return data as DeliveryRow;
    });

    assert.equal(deliveryRow.status, 'delivered');
    assert.equal(deliveryRow.response_status, 200);
    assert.match(deliveryRow.response_body ?? '', /lead\.created/);
    assert.match(deliveryRow.response_body ?? '', new RegExp(leadEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    console.log(
      `[live-client-api] delivery ${deliveryRow.id} ${deliveryRow.status} ` +
      `(attempts=${deliveryRow.attempt_count ?? 0}, response=${deliveryRow.response_status ?? 'n/a'})`,
    );

    console.log('[live-client-api] success');
  } finally {
    await harness.cleanup();
    await cleanupHarnessIdentity(harness, createdAccountId, createdUserId);
  }
}

main().catch((error) => {
  console.error('[live-client-api] failed');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
