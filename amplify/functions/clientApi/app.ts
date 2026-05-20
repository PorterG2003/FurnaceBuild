import crypto from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';
import {
  ClientApiError,
  forbidden,
  invalidRequest,
  notFound,
  rateLimited,
  unauthorized,
} from '../../../lib/client-api/errors.js';
import { getBearerToken, hashApiKey, isApiKeyExpired, type AuthenticatedApiKey } from '../../../lib/client-api/auth.js';
import { toPublicMailbox } from '../../../lib/client-api/serializers/mailbox.js';
import {
  appendCampaignCustomFieldKey,
  getCampaignCustomFieldKeys,
  getCampaignMappedStandardFieldKeys,
} from '../../../lib/client-api/flow-fields.js';
import { buildRateLimitHeaders } from '../../../lib/client-api/rate-limit.js';
import { hashRequestBody } from '../../../lib/client-api/idempotency.js';
import type { Database, Json } from '../../../lib/supabase/types/database.js';

type Variables = {
  apiKey: AuthenticatedApiKey;
  rateLimitHeaders: Record<string, string>;
};

type Supabase = ReturnType<typeof createServiceRoleClient>;

const RATE_LIMIT_REQUESTS_PER_MINUTE = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const BULK_SYNC_LIMIT = 100;
const BULK_ASYNC_LIMIT = 1000;
const MAX_ASYNC_JOBS_PER_ACCOUNT = 3;
const WEBHOOK_VERIFY_USER_AGENT = 'Furnace-Webhook-Verify/1.0';
const DEFAULT_ALLOWED_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'enrollment.created',
  'enrollment.updated',
  'campaign.paused',
  'campaign.resumed',
  'campaign.stopped',
  'email.sent',
  'reply.received',
  'bounce.detected',
] as const;
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

function getBaseUrl(c: Context): string {
  const configured = process.env.CLIENT_API_BASE_URL?.trim() || process.env.CLIENT_API_DOCS_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return new URL(c.req.url).origin.replace(/\/$/, '');
}

function jsonResponse(
  c: Context,
  body: unknown,
  status: ContentfulStatusCode = 200,
  extraHeaders?: Record<string, string>,
) {
  return c.json(body, status, extraHeaders);
}

function getRequestPath(c: Context): string {
  return new URL(c.req.url).pathname;
}

function logRequest(fields: Record<string, unknown>) {
  console.log(JSON.stringify({
    service: 'client-api',
    ...fields,
  }));
}

function parseIntQuery(c: Context, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = c.req.query(key);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, max);
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function currentWindowStart(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString();
}

function nextWindowResetEpochSeconds(): number {
  const now = new Date();
  const reset = new Date(now.getTime());
  reset.setSeconds(0, 0);
  reset.setMinutes(reset.getMinutes() + 1);
  return Math.floor(reset.getTime() / 1000);
}

function normalizeBody(body: unknown): string {
  return JSON.stringify(body ?? {});
}

async function emitWebhookEvent(
  supabase: Supabase,
  input: {
    accountId: string;
    campaignId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }
) {
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: input.accountId,
      campaign_id: input.campaignId ?? null,
      event_type: input.eventType,
      payload: input.payload,
      dedupe_key: input.dedupeKey,
    } as never)
    .select('id')
    .single();
  if (error) {
    throw new Error(`Failed to persist webhook event: ${error.message}`);
  }
  const queueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (!queueUrl) {
    return data.id;
  }
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ eventId: data.id }),
  }));
  return data.id;
}

function parseJsonBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    invalidRequest('invalid_json', 'Request body must be valid JSON');
  }
}

function buildListPayload<T>(data: T[], limit: number, offset: number, totalCount: number) {
  return { data, limit, offset, total_count: totalCount };
}

function getOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Furnace Client API',
      version: '1.0.0',
      description: 'Account-scoped REST API for campaigns, leads, inbox, mailboxes, stats, and block list.',
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                code: { type: 'string' },
                message: { type: 'string' },
                param: { type: 'string' },
              },
              required: ['type', 'code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': { get: { summary: 'Health check', security: [] } },
      '/openapi.json': { get: { summary: 'OpenAPI document', security: [] } },
      '/docs': { get: { summary: 'Scalar docs', security: [] } },
      '/v1/campaigns': { get: { summary: 'List campaigns' } },
      '/v1/campaigns/{id}': { get: { summary: 'Get campaign' }, patch: { summary: 'Update campaign' }, delete: { summary: 'Delete campaign' } },
      '/v1/campaigns/{id}/pause': { post: { summary: 'Pause campaign' } },
      '/v1/campaigns/{id}/stop': { post: { summary: 'Stop campaign' } },
      '/v1/campaigns/{id}/resume': { post: { summary: 'Resume campaign' } },
      '/v1/campaigns/{id}/flow': { get: { summary: 'Get campaign flow' } },
      '/v1/campaigns/{id}/lead-fields': { get: { summary: 'Get lead fields' }, post: { summary: 'Append lead field' } },
      '/v1/campaigns/{id}/leads': { get: { summary: 'List campaign leads' }, post: { summary: 'Create or upsert lead' } },
      '/v1/campaigns/{id}/leads/{leadId}': { get: { summary: 'Get lead' }, patch: { summary: 'Update lead' }, delete: { summary: 'Delete lead' } },
      '/v1/campaigns/{id}/leads/bulk': { post: { summary: 'Bulk sync leads' } },
      '/v1/campaigns/{id}/leads/bulk/async': { post: { summary: 'Queue async lead import' } },
      '/v1/jobs/{id}': { get: { summary: 'Get async import job' } },
      '/v1/mailboxes': { get: { summary: 'List mailboxes' } },
      '/v1/mailboxes/{id}': { get: { summary: 'Get mailbox' } },
      '/v1/threads': { get: { summary: 'List inbox threads' } },
      '/v1/threads/{id}': { get: { summary: 'Get thread' } },
      '/v1/threads/{id}/messages': { get: { summary: 'List thread messages' } },
      '/v1/threads/{id}/reply': { post: { summary: 'Create reply job' } },
      '/v1/block-list': { get: { summary: 'List block list' }, post: { summary: 'Add block list entry' } },
      '/v1/block-list/{id}': { delete: { summary: 'Delete block list entry' } },
      '/v1/campaigns/{id}/stats': { get: { summary: 'Campaign stats' } },
    },
  };
}

async function loadCampaignOrThrow(supabase: Supabase, accountId: string, campaignId: string) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }
  if (!data) {
    notFound('campaign_not_found', 'Campaign not found');
  }
  return data;
}

function assertCampaignMutable(campaign: Database['public']['Tables']['campaigns']['Row']) {
  if (campaign.source === 'smartlead') {
    forbidden('smartlead_read_only', 'Smartlead campaigns are read-only via the API');
  }
  if (campaign.deleted_at) {
    forbidden('campaign_deleted', 'Campaign has been deleted');
  }
}

async function loadLeadOrThrow(
  supabase: Supabase,
  accountId: string,
  campaignId: string,
  leadId: string
) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch lead: ${error.message}`);
  }
  if (!data) {
    notFound('lead_not_found', 'Lead not found');
  }
  return data;
}

async function ensureCampaignEnrollmentsForLeadIds(
  supabase: Supabase,
  campaign: Database['public']['Tables']['campaigns']['Row'],
  leadIds: string[]
) {
  if (leadIds.length === 0) return;
  const rows = leadIds.map((leadId) => ({
    campaign_id: campaign.id,
    account_id: campaign.account_id!,
    lead_id: leadId,
    current_node_id: null,
    state: 'active',
    next_run_at: nowIso(),
    flow_position: {},
    deleted_at: null,
  }));
  const { error } = await supabase
    .from('enrollments')
    .upsert(rows as never[], {
      onConflict: 'campaign_id,lead_id',
      ignoreDuplicates: true,
    });
  if (error) {
    throw new Error(`Failed to ensure enrollments: ${error.message}`);
  }
}

async function listCampaignMailboxes(supabase: Supabase, campaignId: string) {
  const { data: links, error } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch campaign mailboxes: ${error.message}`);
  }
  const mailboxIds = (links ?? []).map((row) => row.mailbox_id);
  if (!mailboxIds.length) return [];
  const { data: mailboxes, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('*')
    .in('id', mailboxIds);
  if (mailboxError) {
    throw new Error(`Failed to fetch campaign mailboxes: ${mailboxError.message}`);
  }
  return mailboxes ?? [];
}

async function replaceCampaignMailboxes(
  supabase: Supabase,
  campaign: Database['public']['Tables']['campaigns']['Row'],
  mailboxIds: string[]
) {
  const { error: deleteError } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', campaign.id);
  if (deleteError) {
    throw new Error(`Failed to replace campaign mailboxes: ${deleteError.message}`);
  }
  if (!mailboxIds.length) return;
  const assignments = mailboxIds.map((mailboxId) => ({
    campaign_id: campaign.id,
    mailbox_id: mailboxId,
    account_id: campaign.account_id!,
  }));
  const { error } = await supabase.from('campaign_mailboxes').insert(assignments);
  if (error) {
    throw new Error(`Failed to assign campaign mailboxes: ${error.message}`);
  }
}

async function getRateLimitedHeadersOrThrow(supabase: Supabase, accountId: string): Promise<Record<string, string>> {
  const windowStart = currentWindowStart();
  const resetEpochSeconds = nextWindowResetEpochSeconds();
  const { data: existing, error: loadError } = await supabase
    .from('api_rate_limit_buckets')
    .select('id, request_count')
    .eq('account_id', accountId)
    .eq('window_start', windowStart)
    .maybeSingle();
  if (loadError) {
    throw new Error(`Failed to check API rate limit bucket: ${loadError.message}`);
  }
  const nextCount = (existing?.request_count ?? 0) + 1;
  if (nextCount > RATE_LIMIT_REQUESTS_PER_MINUTE) {
    rateLimited('rate_limit_exceeded', 'Rate limit exceeded for this account');
  }
  if (existing?.id) {
    const { error } = await supabase
      .from('api_rate_limit_buckets')
      .update({
        request_count: nextCount,
        updated_at: nowIso(),
      })
      .eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update API rate limit bucket: ${error.message}`);
    }
  } else {
    const { error } = await supabase.from('api_rate_limit_buckets').insert({
      account_id: accountId,
      window_start: windowStart,
      request_count: 1,
    } as never);
    if (error) {
      throw new Error(`Failed to create API rate limit bucket: ${error.message}`);
    }
  }
  return buildRateLimitHeaders({
    limit: RATE_LIMIT_REQUESTS_PER_MINUTE,
    remaining: RATE_LIMIT_REQUESTS_PER_MINUTE - nextCount,
    resetEpochSeconds,
  });
}

async function getCachedIdempotencyResponse(
  supabase: Supabase,
  accountId: string,
  idempotencyKey: string | null,
  route: string,
  bodyHash: string
) {
  if (!idempotencyKey) return null;
  const { data, error } = await supabase
    .from('api_idempotency_keys')
    .select('response')
    .eq('account_id', accountId)
    .eq('idempotency_key', idempotencyKey)
    .eq('route', route)
    .eq('body_hash', bodyHash)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to check idempotency cache: ${error.message}`);
  }
  return data?.response ?? null;
}

async function saveIdempotencyResponse(
  supabase: Supabase,
  accountId: string,
  idempotencyKey: string | null,
  route: string,
  bodyHash: string,
  response: unknown
) {
  if (!idempotencyKey) return;
  const { error } = await supabase.from('api_idempotency_keys').upsert({
    account_id: accountId,
    idempotency_key: idempotencyKey,
    route,
    body_hash: bodyHash,
    response: response as Json,
  } as never, {
    onConflict: 'account_id,idempotency_key,route,body_hash',
  });
  if (error) {
    throw new Error(`Failed to save idempotency response: ${error.message}`);
  }
}

async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  const supabase = createServiceRoleClient();
  const token = getBearerToken(c.req.header('Authorization') ?? null);
  if (!token || !token.startsWith('f_')) {
    unauthorized('invalid_api_key', 'A valid Furnace API key is required');
  }
  const keyHash = hashApiKey(token);
  const { data, error } = await supabase
    .from('account_api_keys')
    .select('id, account_id, name, secret_prefix, expires_at, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to authenticate API key: ${error.message}`);
  }
  if (!data) {
    unauthorized('invalid_api_key', 'API key not recognized');
  }
  if (data.revoked_at) {
    unauthorized('revoked_api_key', 'API key has been revoked');
  }
  if (isApiKeyExpired(data.expires_at)) {
    unauthorized('expired_api_key', 'API key has expired');
  }
  const rateLimitHeaders = await getRateLimitedHeadersOrThrow(supabase, data.account_id);
  await supabase
    .from('account_api_keys')
    .update({ last_used_at: nowIso(), updated_at: nowIso() })
    .eq('id', data.id);
  c.set('apiKey', {
    id: data.id,
    accountId: data.account_id,
    name: data.name,
    secretPrefix: data.secret_prefix,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
  });
  c.set('rateLimitHeaders', rateLimitHeaders);
  await next();
}

async function internalJwtAuth(c: Context, next: Next) {
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return c.body(null, 204);
  }
  const token = getBearerToken(c.req.header('Authorization') ?? null);
  if (!token || token.startsWith('f_')) {
    unauthorized('invalid_token', 'A valid user session token is required');
  }
  const supabase = createServiceRoleClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    unauthorized('invalid_token', 'User session is invalid or expired');
  }
  (c as any).set('userId', user.id);
  await next();
}

export const app = new Hono<{ Variables: Variables }>();

app.use('*', async (c, next) => {
  const startedAt = Date.now();
  const requestId =
    c.req.header('x-amzn-requestid') ??
    c.req.header('x-amzn-trace-id') ??
    crypto.randomUUID();

  try {
    await next();
    logRequest({
      request_id: requestId,
      method: c.req.method,
      path: getRequestPath(c),
      status: c.res.status,
      duration_ms: Date.now() - startedAt,
      account_id: c.get('apiKey')?.accountId ?? null,
      api_key_id: c.get('apiKey')?.id ?? null,
    });
  } catch (error) {
    logRequest({
      request_id: requestId,
      method: c.req.method,
      path: getRequestPath(c),
      status: error instanceof ClientApiError ? error.status : 500,
      duration_ms: Date.now() - startedAt,
      account_id: c.get('apiKey')?.accountId ?? null,
      api_key_id: c.get('apiKey')?.id ?? null,
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

app.onError((err, c) => {
  if (err instanceof ClientApiError) {
    return jsonResponse(c, err.payload, err.status as ContentfulStatusCode, c.get('rateLimitHeaders'));
  }
  console.error(JSON.stringify({
    service: 'client-api',
    level: 'error',
    message: 'Unhandled error',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: getRequestPath(c),
  }));
  return jsonResponse(
    c,
    {
      error: {
        type: 'api_error',
        code: 'internal_error',
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    },
    500,
    c.get('rateLimitHeaders')
  );
});

app.get('/health', async (c) => {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('accounts').select('id').limit(1);
  if (error) {
    return jsonResponse(c, { status: 'error', db: 'error' }, 503);
  }
  return jsonResponse(c, { status: 'ok', db: 'ok' });
});

app.get('/openapi.json', async (c) => {
  return jsonResponse(c, getOpenApiSpec(getBaseUrl(c)));
});

app.get('/docs', async (c) => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Furnace Client API Docs</title>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${getBaseUrl(c)}/openapi.json"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
  return c.html(html);
});

app.use('/v1/*', authMiddleware);

app.get('/v1/campaigns', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const includeDeleted = c.req.query('include_deleted') === 'true';
  const q = c.req.query('q')?.trim();
  const status = c.req.query('status')?.trim();
  let query = supabase
    .from('campaigns')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: false });
  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }
  if (status) query = query.eq('status', status as any);
  if (q) {
    query = query.ilike('name', `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }
  return jsonResponse(c, buildListPayload(data ?? [], limit, offset, count ?? 0), 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const campaign = await loadCampaignOrThrow(supabase, c.get('apiKey').accountId, c.req.param('id'));
  return jsonResponse(c, { data: campaign }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id/flow', async (c) => {
  const supabase = createServiceRoleClient();
  const campaign = await loadCampaignOrThrow(supabase, c.get('apiKey').accountId, c.req.param('id'));
  return jsonResponse(c, { data: campaign.flow_data ?? { nodes: [], edges: [] } }, 200, c.get('rateLimitHeaders'));
});

app.patch('/v1/campaigns/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<Record<string, unknown>>(await c.req.text());
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (body.schedule) patch.schedule = body.schedule;
  if (typeof body.sending_interval_seconds === 'number') {
    patch.sending_interval_seconds = body.sending_interval_seconds;
  }
  const addMailboxIds = Array.isArray(body.add_mailbox_ids) ? body.add_mailbox_ids.filter((value): value is string => typeof value === 'string') : [];
  const removeMailboxIds = Array.isArray(body.remove_mailbox_ids) ? body.remove_mailbox_ids.filter((value): value is string => typeof value === 'string') : [];
  const replaceMailboxIds = Array.isArray(body.mailbox_ids) ? body.mailbox_ids.filter((value): value is string => typeof value === 'string') : null;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from('campaigns')
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', campaign.id)
      .eq('account_id', auth.accountId);
    if (error) {
      throw new Error(`Failed to update campaign: ${error.message}`);
    }
  }
  if (replaceMailboxIds) {
    await replaceCampaignMailboxes(supabase, campaign, replaceMailboxIds);
  } else if (addMailboxIds.length || removeMailboxIds.length) {
    const currentMailboxes = await listCampaignMailboxes(supabase, campaign.id);
    const nextMailboxIds = new Set<string>(currentMailboxes.map((mailbox: any) => mailbox.id));
    for (const mailboxId of addMailboxIds) nextMailboxIds.add(mailboxId);
    for (const mailboxId of removeMailboxIds) nextMailboxIds.delete(mailboxId);
    await replaceCampaignMailboxes(supabase, campaign, [...nextMailboxIds]);
  }
  const refreshed = await loadCampaignOrThrow(supabase, auth.accountId, campaign.id);
  return jsonResponse(c, { data: refreshed }, 200, c.get('rateLimitHeaders'));
});

app.delete('/v1/campaigns/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const now = nowIso();
  const [campaignResult, enrollmentsResult, nodesResult] = await Promise.all([
    supabase.from('campaigns').update({ deleted_at: now, status: 'stopped', updated_at: now }).eq('id', campaign.id).is('deleted_at', null),
    supabase.from('enrollments').update({ deleted_at: now, state: 'stopped', next_run_at: null, updated_at: now }).eq('campaign_id', campaign.id).is('deleted_at', null),
    supabase.from('nodes').update({ deleted_at: now, updated_at: now }).eq('campaign_id', campaign.id).is('deleted_at', null),
  ]);
  if (campaignResult.error) throw new Error(`Failed to delete campaign: ${campaignResult.error.message}`);
  if (enrollmentsResult.error) throw new Error(`Failed to delete campaign enrollments: ${enrollmentsResult.error.message}`);
  if (nodesResult.error) throw new Error(`Failed to delete campaign nodes: ${nodesResult.error.message}`);
  return jsonResponse(c, { data: { id: campaign.id, deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/pause', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const { error } = await supabase.rpc('pause_campaign_and_defer_jobs', { p_campaign_id: campaign.id });
  if (error) throw new Error(`Failed to pause campaign: ${error.message}`);
  await emitWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    eventType: 'campaign.paused',
    payload: { campaign_id: campaign.id },
    dedupeKey: `campaign.paused:${campaign.id}:${Date.now()}`,
  });
  return jsonResponse(c, { data: { id: campaign.id, status: 'paused' } }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/stop', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const { error } = await supabase.rpc('stop_campaign_and_stop_enrollments', { p_campaign_id: campaign.id });
  if (error) throw new Error(`Failed to stop campaign: ${error.message}`);
  await emitWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    eventType: 'campaign.stopped',
    payload: { campaign_id: campaign.id },
    dedupeKey: `campaign.stopped:${campaign.id}:${Date.now()}`,
  });
  return jsonResponse(c, { data: { id: campaign.id, status: 'stopped' } }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/resume', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  if (campaign.status !== 'paused') {
    invalidRequest('campaign_not_paused', 'Only paused campaigns can be resumed');
  }
  const { error } = await supabase.rpc('resume_campaign_and_reschedule_jobs', {
    p_campaign_id: campaign.id,
    p_pause_reason: 'Campaign paused',
  });
  if (error) throw new Error(`Failed to resume campaign: ${error.message}`);
  await emitWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    eventType: 'campaign.resumed',
    payload: { campaign_id: campaign.id },
    dedupeKey: `campaign.resumed:${campaign.id}:${Date.now()}`,
  });
  return jsonResponse(c, { data: { id: campaign.id, status: 'running' } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id/lead-fields', async (c) => {
  const supabase = createServiceRoleClient();
  const campaign = await loadCampaignOrThrow(supabase, c.get('apiKey').accountId, c.req.param('id'));
  return jsonResponse(
    c,
    {
      data: {
        standard: getCampaignMappedStandardFieldKeys(campaign.flow_data),
        custom: getCampaignCustomFieldKeys(campaign.flow_data),
      },
    },
    200,
    c.get('rateLimitHeaders')
  );
});

app.post('/v1/campaigns/:id/lead-fields', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<{ key?: string }>(await c.req.text());
  const key = body.key?.trim();
  if (!key) invalidRequest('missing_field_key', 'Lead field key is required', 'key');
  const nextFlowData = appendCampaignCustomFieldKey(campaign.flow_data, key);
  const { error } = await supabase.rpc('update_campaign_flow_data', {
    p_campaign_id: campaign.id,
    p_flow_data: nextFlowData,
    p_change_source: 'client_api',
  });
  if (error) throw new Error(`Failed to append lead field: ${error.message}`);
  return jsonResponse(c, { data: { key } }, 200, c.get('rateLimitHeaders'));
});

async function upsertCampaignLead(params: {
  supabase: Supabase;
  campaign: Database['public']['Tables']['campaigns']['Row'];
  lead: Record<string, unknown>;
  shouldEnsureEnrollment: boolean;
}) {
  const { supabase, campaign, lead, shouldEnsureEnrollment } = params;
  const email = normalizeEmail(typeof lead.email === 'string' ? lead.email : null);
  if (!email) invalidRequest('missing_email', 'Lead email is required', 'email');
  const customFieldKeys = getCampaignCustomFieldKeys(campaign.flow_data);
  const bodyCustomLeadData = (lead.custom_lead_data ?? {}) as Record<string, unknown>;
  for (const key of customFieldKeys) {
    if (!(key in bodyCustomLeadData)) {
      invalidRequest('missing_custom_field', `Lead payload must include custom field "${key}"`, `custom_lead_data.${key}`);
    }
  }
  const { data: existing, error: existingError } = await supabase
    .from('leads')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('account_id', campaign.account_id!)
    .eq('email', email)
    .is('deleted_at', null)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check for existing lead: ${existingError.message}`);
  const patch = {
    email,
    name: typeof lead.name === 'string' ? lead.name.trim() || null : null,
    first_name: typeof lead.first_name === 'string' ? lead.first_name.trim() || null : null,
    last_name: typeof lead.last_name === 'string' ? lead.last_name.trim() || null : null,
    company_name: typeof lead.company_name === 'string' ? lead.company_name.trim() || null : null,
    website: typeof lead.website === 'string' ? lead.website.trim() || null : null,
    linkedin_url: typeof lead.linkedin_url === 'string' ? lead.linkedin_url.trim() || null : null,
    company_linkedin_url: typeof lead.company_linkedin_url === 'string' ? lead.company_linkedin_url.trim() || null : null,
    custom_lead_data: bodyCustomLeadData as Json,
    source: 'api',
    updated_at: nowIso(),
  };
  if (existing) {
    const { data, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(`Failed to update lead: ${error.message}`);
    return { lead: data, created: false };
  }
  const insertPayload = {
    ...patch,
    global_lead_id: sha256(email),
    campaign_id: campaign.id,
    bucket_id: campaign.bucket_id,
    account_id: campaign.account_id!,
    status: 'new',
    created_at: nowIso(),
  };
  const { data, error } = await supabase.from('leads').insert(insertPayload as never).select('*').single();
  if (error) throw new Error(`Failed to create lead: ${error.message}`);
  if (shouldEnsureEnrollment) {
    await ensureCampaignEnrollmentsForLeadIds(supabase, campaign, [data.id]);
  }
  return { lead: data, created: true };
}

app.get('/v1/campaigns/:id/leads', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const search = c.req.query('q')?.trim();
  const status = c.req.query('status')?.trim();
  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaign.id)
    .eq('account_id', auth.accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (search) {
    const pattern = `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    query = query.or(`email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`);
  }
  if (status) {
    query = query.eq('status', status as any);
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list leads: ${error.message}`);
  return jsonResponse(c, buildListPayload(data ?? [], limit, offset, count ?? 0), 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/leads', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const rawBody = await c.req.text();
  const body = parseJsonBody<Record<string, unknown>>(rawBody);
  const idempotencyKey = c.req.header('Idempotency-Key') ?? null;
  const bodyHash = hashRequestBody(rawBody);
  const cached = await getCachedIdempotencyResponse(supabase, auth.accountId, idempotencyKey, getRequestPath(c), bodyHash);
  if (cached) {
    return jsonResponse(c, cached, 200, c.get('rateLimitHeaders'));
  }
  const result = await upsertCampaignLead({
    supabase,
    campaign,
    lead: body,
    shouldEnsureEnrollment: true,
  });
  const payload = { data: result.lead, created: result.created };
  await saveIdempotencyResponse(supabase, auth.accountId, idempotencyKey, getRequestPath(c), bodyHash, payload);
  if (result.created) {
    await emitWebhookEvent(supabase, {
      accountId: auth.accountId,
      campaignId: campaign.id,
      eventType: 'lead.created',
      payload: {
        campaign_id: campaign.id,
        lead_id: result.lead.id,
        email: result.lead.email,
      },
      dedupeKey: `lead.created:${result.lead.id}`,
    });
  } else {
    await emitWebhookEvent(supabase, {
      accountId: auth.accountId,
      campaignId: campaign.id,
      eventType: 'lead.updated',
      payload: {
        campaign_id: campaign.id,
        lead_id: result.lead.id,
        email: result.lead.email,
      },
      dedupeKey: `lead.updated:${result.lead.id}:${bodyHash}`,
    });
  }
  return jsonResponse(c, payload, result.created ? 201 : 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id/leads/:leadId', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  const lead = await loadLeadOrThrow(supabase, auth.accountId, c.req.param('id'), c.req.param('leadId'));
  return jsonResponse(c, { data: lead }, 200, c.get('rateLimitHeaders'));
});

app.patch('/v1/campaigns/:id/leads/:leadId', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const lead = await loadLeadOrThrow(supabase, auth.accountId, campaign.id, c.req.param('leadId'));
  const body = parseJsonBody<Record<string, unknown>>(await c.req.text());
  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'first_name', 'last_name', 'company_name', 'website', 'linkedin_url', 'company_linkedin_url']) {
    if (key in body) {
      patch[key] = typeof body[key] === 'string' ? (body[key] as string).trim() || null : body[key];
    }
  }
  if ('email' in body) patch.email = normalizeEmail(typeof body.email === 'string' ? body.email : null);
  if ('custom_lead_data' in body) patch.custom_lead_data = body.custom_lead_data ?? {};
  const { data, error } = await supabase
    .from('leads')
    .update({ ...patch, updated_at: nowIso() })
    .eq('id', lead.id)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update lead: ${error.message}`);
  await emitWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    eventType: 'lead.updated',
    payload: { campaign_id: campaign.id, lead_id: lead.id, email: data.email },
    dedupeKey: `lead.updated:${lead.id}:${Date.now()}`,
  });
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.delete('/v1/campaigns/:id/leads/:leadId', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const lead = await loadLeadOrThrow(supabase, auth.accountId, campaign.id, c.req.param('leadId'));
  const now = nowIso();
  const [leadResult, enrollmentResult, jobsResult] = await Promise.all([
    supabase.from('leads').update({ status: 'removed', deleted_at: now, updated_at: now }).eq('id', lead.id).is('deleted_at', null),
    supabase.from('enrollments').update({ deleted_at: now, state: 'stopped', next_run_at: null, updated_at: now }).eq('lead_id', lead.id).is('deleted_at', null),
    supabase.from('message_jobs').update({ status: 'cancelled', status_reason: 'lead_deleted', error_message: 'Lead deleted', updated_at: now }).eq('lead_id', lead.id).in('status', ['queued', 'reserved']).or('message_type.eq.campaign,message_type.is.null'),
  ]);
  if (leadResult.error) throw new Error(`Failed to delete lead: ${leadResult.error.message}`);
  if (enrollmentResult.error) throw new Error(`Failed to delete lead enrollments: ${enrollmentResult.error.message}`);
  if (jobsResult.error) throw new Error(`Failed to cancel deleted lead jobs: ${jobsResult.error.message}`);
  await emitWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    eventType: 'lead.deleted',
    payload: { campaign_id: campaign.id, lead_id: lead.id, email: lead.email },
    dedupeKey: `lead.deleted:${lead.id}`,
  });
  return jsonResponse(c, { data: { id: lead.id, deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/leads/bulk', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const rawBody = await c.req.text();
  const body = parseJsonBody<{ leads?: Record<string, unknown>[] }>(rawBody);
  const rows = Array.isArray(body.leads) ? body.leads : [];
  if (rows.length === 0) invalidRequest('missing_leads', 'Bulk request must include a non-empty leads array', 'leads');
  if (rows.length > BULK_SYNC_LIMIT) invalidRequest('too_many_leads', `Bulk sync is limited to ${BULK_SYNC_LIMIT} rows`, 'leads');
  const idempotencyKey = c.req.header('Idempotency-Key') ?? null;
  const bodyHash = hashRequestBody(rawBody);
  const cached = await getCachedIdempotencyResponse(supabase, auth.accountId, idempotencyKey, getRequestPath(c), bodyHash);
  if (cached) {
    return jsonResponse(c, cached, 200, c.get('rateLimitHeaders'));
  }
  const errors: Array<{ index: number; message: string }> = [];
  let imported = 0;
  let failed = 0;
  for (let index = 0; index < rows.length; index += 1) {
    try {
      await upsertCampaignLead({ supabase, campaign, lead: rows[index], shouldEnsureEnrollment: true });
      imported += 1;
    } catch (error) {
      failed += 1;
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const payload = { imported, failed, errors };
  await saveIdempotencyResponse(supabase, auth.accountId, idempotencyKey, getRequestPath(c), bodyHash, payload);
  return jsonResponse(c, payload, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/leads/bulk/async', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<{ leads?: Record<string, unknown>[] }>(await c.req.text());
  const rows = Array.isArray(body.leads) ? body.leads : [];
  if (rows.length === 0) invalidRequest('missing_leads', 'Async import must include a non-empty leads array', 'leads');
  if (rows.length > BULK_ASYNC_LIMIT) invalidRequest('too_many_leads', `Async import is limited to ${BULK_ASYNC_LIMIT} rows`, 'leads');
  const { count, error: countError } = await supabase
    .from('api_import_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', auth.accountId)
    .in('status', ['queued', 'running']);
  if (countError) throw new Error(`Failed to count async import jobs: ${countError.message}`);
  if ((count ?? 0) >= MAX_ASYNC_JOBS_PER_ACCOUNT) {
    rateLimited('too_many_async_jobs', `Only ${MAX_ASYNC_JOBS_PER_ACCOUNT} concurrent async import jobs are allowed`);
  }
  const { data: job, error } = await supabase
    .from('api_import_jobs')
    .insert({
      account_id: auth.accountId,
      campaign_id: campaign.id,
      created_by_api_key_id: auth.id,
      status: 'queued',
      input: { leads: rows },
      result: {},
      errors: [],
    } as never)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create async import job: ${error.message}`);
  const queueUrl = process.env.CLIENT_API_IMPORT_QUEUE_URL?.trim();
  if (queueUrl) {
    const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ jobId: job.id }),
    }));
  }
  return jsonResponse(c, { data: job }, 202, c.get('rateLimitHeaders'));
});

app.get('/v1/jobs/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('api_import_jobs')
    .select('*')
    .eq('id', c.req.param('id'))
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch async import job: ${error.message}`);
  if (!data) notFound('job_not_found', 'Async import job not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/mailboxes', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const { data, error, count } = await supabase
    .from('mailboxes')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list mailboxes: ${error.message}`);
  return jsonResponse(
    c,
    buildListPayload((data ?? []).map((mailbox) => toPublicMailbox(mailbox as any)), limit, offset, count ?? 0),
    200,
    c.get('rateLimitHeaders')
  );
});

app.get('/v1/mailboxes/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('id', c.req.param('id'))
    .eq('account_id', auth.accountId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch mailbox: ${error.message}`);
  if (!data) notFound('mailbox_not_found', 'Mailbox not found');
  return jsonResponse(c, { data: toPublicMailbox(data as any) }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/threads', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  let query = supabase
    .from('email_threads')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .order('last_message_at', { ascending: false });
  const campaignId = c.req.query('campaign_id');
  const mailboxId = c.req.query('mailbox_id');
  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (mailboxId) query = query.eq('mailbox_id', mailboxId);
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list threads: ${error.message}`);
  return jsonResponse(c, buildListPayload(data ?? [], limit, offset, count ?? 0), 200, c.get('rateLimitHeaders'));
});

app.get('/v1/threads/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
    .eq('id', c.req.param('id'))
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch thread: ${error.message}`);
  if (!data) notFound('thread_not_found', 'Thread not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/threads/:id/messages', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id')
    .eq('id', c.req.param('id'))
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (threadError) throw new Error(`Failed to fetch thread for messages: ${threadError.message}`);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('thread_id', c.req.param('id'))
    .order('received_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch thread messages: ${error.message}`);
  return jsonResponse(c, { data: data ?? [] }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/threads/:id/reply', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, account_id, mailbox_id')
    .eq('id', threadId)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (threadError) throw new Error(`Failed to fetch thread: ${threadError.message}`);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<{ subject?: string; body_text?: string; body_html?: string; to_email?: string; to_name?: string; cc?: string[] }>(await c.req.text());
  const { data: messages, error: messageError } = await supabase
    .from('email_messages')
    .select('id, subject, from_email, from_name, to_email')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: false })
    .limit(1);
  if (messageError) throw new Error(`Failed to fetch reply target message: ${messageError.message}`);
  const lastMessage = messages?.[0];
  if (!lastMessage) invalidRequest('thread_empty', 'Thread has no messages to reply to');
  const { data, error } = await supabase.rpc('create_inbox_reply_job', {
    p_account_id: auth.accountId,
    p_thread_id: threadId,
    p_in_reply_to_message_id: lastMessage.id,
    p_subject: body.subject?.trim() || lastMessage.subject || 'Re:',
    p_body_text: body.body_text?.trim() || '',
    p_body_html: body.body_html?.trim() || body.body_text?.trim() || '',
    p_to_email: body.to_email?.trim() || lastMessage.from_email || lastMessage.to_email,
    p_to_name: body.to_name?.trim() || lastMessage.from_name || null,
    p_cc: Array.isArray(body.cc) && body.cc.length > 0 ? body.cc : null,
  });
  if (error) throw new Error(`Failed to create reply job: ${error.message}`);
  return jsonResponse(c, { data: { id: data } }, 202, c.get('rateLimitHeaders'));
});

app.get('/v1/block-list', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const search = c.req.query('q')?.trim();
  let query = supabase
    .from('block_list')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: false });
  if (search) {
    query = query.ilike('value', `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list block list entries: ${error.message}`);
  return jsonResponse(c, buildListPayload(data ?? [], limit, offset, count ?? 0), 200, c.get('rateLimitHeaders'));
});

app.post('/v1/block-list', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ value?: string; type?: 'email' | 'domain'; reason?: string | null }>(await c.req.text());
  const value = normalizeEmail(body.value);
  const type = body.type;
  if (!value) invalidRequest('missing_value', 'Block list value is required', 'value');
  if (type !== 'email' && type !== 'domain') invalidRequest('invalid_type', 'Block list type must be email or domain', 'type');
  const { data: existing } = await supabase
    .from('block_list')
    .select('*')
    .eq('account_id', auth.accountId)
    .eq('value', value)
    .eq('type', type)
    .maybeSingle();
  if (existing) {
    return jsonResponse(c, { data: existing }, 200, c.get('rateLimitHeaders'));
  }
  const { data, error } = await supabase
    .from('block_list')
    .insert({
      account_id: auth.accountId,
      value,
      type,
      reason: body.reason ?? 'manual',
    } as never)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to add block list entry: ${error.message}`);
  return jsonResponse(c, { data }, 201, c.get('rateLimitHeaders'));
});

app.delete('/v1/block-list/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { error } = await supabase
    .from('block_list')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('account_id', auth.accountId);
  if (error) throw new Error(`Failed to delete block list entry: ${error.message}`);
  return jsonResponse(c, { data: { id: c.req.param('id'), deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id/stats', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  const startDate = c.req.query('start_date') ?? campaign.created_at.slice(0, 10);
  const endDate = c.req.query('end_date') ?? new Date().toISOString().slice(0, 10);
  let daily: any[] = [];
  if (campaign.source === 'smartlead') {
    const { data, error } = await supabase
      .from('imported_campaign_stats_by_day')
      .select('date, sent_count, replied_count, positive_reply_count, bounce_count')
      .eq('campaign_id', campaign.id)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    if (error) throw new Error(`Failed to fetch smartlead stats: ${error.message}`);
    daily = (data ?? []).map((row: any) => ({
      date: row.date,
      sent: row.sent_count ?? 0,
      replied: row.replied_count ?? 0,
      positiveReply: row.positive_reply_count ?? 0,
      bounce: row.bounce_count ?? 0,
    }));
  } else {
    const { data, error } = await supabase.rpc('campaign_stats_by_day', {
      p_campaign_id: campaign.id,
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) throw new Error(`Failed to fetch campaign stats: ${error.message}`);
    daily = (data ?? []).map((row: any) => ({
      date: row.stat_date,
      sent: Number(row.sent_count ?? 0),
      replied: Number(row.replied_count ?? 0),
      positiveReply: Number(row.positive_reply_count ?? 0),
      bounce: Number(row.bounce_count ?? 0),
    }));
  }
  const [{ data: statsRow }, { count: enrollmentCount }, { count: terminalEnrollmentCount }, { data: contactedRows }] = await Promise.all([
    supabase
      .from('campaign_stats')
      .select('sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at')
      .eq('campaign_id', campaign.id)
      .maybeSingle(),
    supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).is('deleted_at', null),
    supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).is('deleted_at', null).in('state', ['stopped', 'completed']),
    supabase.rpc('get_campaign_contacted_counts', { p_campaign_ids: [campaign.id] }),
  ]);
  const contacted = Array.isArray(contactedRows) ? Number(contactedRows[0]?.contacted_count ?? 0) : 0;
  return jsonResponse(
    c,
    {
      data: {
        daily,
        totals: {
          sentCount: Number((statsRow as any)?.sent_count ?? 0),
          repliedCount: Number((statsRow as any)?.replied_count ?? 0),
          positiveReplyCount: Number((statsRow as any)?.positive_reply_count ?? 0),
          bounceCount: Number((statsRow as any)?.bounce_count ?? 0),
          lastBounceAt: (statsRow as any)?.last_bounce_at ?? null,
          enrollmentCount: enrollmentCount ?? 0,
          terminalEnrollmentCount: terminalEnrollmentCount ?? 0,
          contactedEnrollmentCount: contacted,
        },
      },
    },
    200,
    c.get('rateLimitHeaders')
  );
});

app.use('/internal/*', internalJwtAuth);

app.post('/internal/webhook/verify', async (c) => {
  const supabase = createServiceRoleClient();
  const body = parseJsonBody<{ accountId?: string; campaignId?: string | null; url?: string }>(await c.req.text());
  const accountId = body.accountId?.trim();
  const url = body.url?.trim();
  const userId = (c as any).get('userId') as string;
  if (!accountId || !url) invalidRequest('missing_fields', 'accountId and url are required');
  const { data: membership, error: membershipError } = await supabase
    .from('account_users')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Failed to verify membership: ${membershipError.message}`);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    forbidden('account_admin_required', 'Only account owners and admins can verify webhook URLs');
  }
  const verifyToken = crypto.randomUUID();
  const verifyPayload = {
    type: 'webhook.verify',
    token: verifyToken,
    account_id: accountId,
    campaign_id: body.campaignId ?? null,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_VERIFY_USER_AGENT,
    },
    body: JSON.stringify(verifyPayload),
  });
  let responseBody = '';
  try {
    responseBody = await response.text();
  } catch {
    responseBody = '';
  }
  const isVerified = response.ok && responseBody.includes(verifyToken);
  return jsonResponse(c, {
    data: {
      verified: isVerified,
      status: response.status,
      token: verifyToken,
      response_body: responseBody.slice(0, 2000),
    },
  }, isVerified ? 200 : 422);
});
