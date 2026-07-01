import crypto from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
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
import {
  applyCampaignTagPatch,
  attachTagsToCampaignRow,
  getCampaignIdsMatchingAnyTag,
  getTagsForCampaignIds,
  listAccountCampaignTags,
} from '../../../lib/client-api/campaign-tags.js';
import {
  applyMailboxTagPatch,
  attachTagsToMailboxRow,
  getMailboxIdsMatchingAnyTag,
  getTagsForMailboxIds,
  listAccountMailboxTags,
} from '../../../lib/client-api/mailbox-tags.js';
import { hashRequestBody } from '../../../lib/client-api/idempotency.js';
import { startApiImportJob } from '../../../lib/client-api/jobs.js';
import {
  stableGlobalLeadIdsKey,
} from '../../../lib/client-api/webhooks/batchCompletion.js';
import { insertBatchCompletionWebhookEvent } from '../../../lib/client-api/webhooks/emitBatchCompletion.js';
import {
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_PAGE_SIZE,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
} from '../../../lib/client-api/openapi/constants.js';
import { deliverWebhookPost, isValidHttpsWebhookUrl } from '../../../lib/client-api/webhooks/deliverWebhookPost.js';
import {
  buildWebhookTestPayload,
  isAllowedWebhookEventType,
} from '../../../lib/client-api/webhooks/webhookTestSamples.js';
import { buildClientApiOpenApiSpec } from '../../../lib/client-api/openapi/spec.js';
import { THREAD_CATEGORIES } from '../../../lib/client-api/inbox/constants.js';
import { recordClientApiInboxInteraction } from '../../../lib/client-api/inbox/interactions.js';
import {
  cancelAccountMessageJob,
  createInboxForwardJob,
  createInboxReplyJob,
  clearThreadOutOfOffice,
  loadAccountMessageJobOrThrow,
  loadLatestThreadMessage,
  loadThreadMessageOrThrow,
  saveThreadOutOfOffice,
  sendAccountMessageJobNow,
  toPublicMessageJob,
  type OutboundComposerBody,
} from '../../../lib/client-api/inbox/message-jobs.js';
import {
  isValidThreadCategory,
  listAccountThreads,
  loadAccountThreadOrThrow,
  patchAccountThread,
} from '../../../lib/client-api/inbox/threads.js';
import { buildInteractionIntent } from '../../../lib/inbox/buildInteractionIntent.js';
import { parseSmartHandlingMetadata } from '../../../lib/inbox/smartHandling.js';
import type { Database, Json } from '../../../lib/supabase/types/database.js';

type Variables = {
  apiKey: AuthenticatedApiKey;
  rateLimitHeaders: Record<string, string>;
};

type Supabase = ReturnType<typeof createServiceRoleClient>;

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
const sfn = new SFNClient({ region: process.env.AWS_REGION || 'us-west-2' });

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
  return buildClientApiOpenApiSpec(baseUrl);
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

async function loadMailboxOrThrow(supabase: Supabase, accountId: string, mailboxId: string) {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch mailbox: ${error.message}`);
  }
  if (!data) {
    notFound('mailbox_not_found', 'Mailbox not found');
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
  const baseUrl = getBaseUrl(c);
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Furnace Client API Docs</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        theme: 'purple',
        defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
        searchHotKey: 'k',
        showSidebar: true,
        expanded: true,
        defaultOpenFirstTag: false,
        sources: [{ url: '${baseUrl}/openapi.json' }],
      });
    </script>
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
  const tagIdsParam = c.req.query('tag_ids')?.trim();
  const tagFilterIds = tagIdsParam
    ? tagIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
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
  if (tagFilterIds.length > 0) {
    const matchingIds = await getCampaignIdsMatchingAnyTag(supabase, auth.accountId, tagFilterIds);
    if (matchingIds.length === 0) {
      return jsonResponse(c, buildListPayload([], limit, offset, 0), 200, c.get('rateLimitHeaders'));
    }
    query = query.in('id', matchingIds);
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }
  const rows = data ?? [];
  const tagsMap = await getTagsForCampaignIds(
    supabase,
    rows.map((row) => row.id),
  );
  const enriched = rows.map((row) => attachTagsToCampaignRow(row, tagsMap));
  return jsonResponse(c, buildListPayload(enriched, limit, offset, count ?? 0), 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaign-tags', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tags = await listAccountCampaignTags(supabase, auth.accountId);
  return jsonResponse(c, { data: tags }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaign-tags', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ name?: string; color?: string | null }>(await c.req.text());
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) invalidRequest('validation_error', 'name is required');
  const { data, error } = await supabase
    .from('campaign_tags')
    .insert({
      account_id: auth.accountId,
      name,
      color: body.color ?? null,
    })
    .select('id, name, color, created_at')
    .single();
  if (error) throw new Error(`Failed to create campaign tag: ${error.message}`);
  return jsonResponse(c, { data }, 201, c.get('rateLimitHeaders'));
});

app.patch('/v1/campaign-tags/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tagId = c.req.param('id');
  const body = parseJsonBody<{ name?: string; color?: string | null }>(await c.req.text());
  const updates: { name?: string; color?: string | null } = {};
  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (body.color !== undefined) updates.color = body.color;
  if (Object.keys(updates).length === 0) {
    invalidRequest('validation_error', 'No mutable fields provided');
  }
  const { data, error } = await supabase
    .from('campaign_tags')
    .update(updates)
    .eq('id', tagId)
    .eq('account_id', auth.accountId)
    .select('id, name, color, created_at')
    .single();
  if (error) throw new Error(`Failed to update campaign tag: ${error.message}`);
  if (!data) notFound('tag_not_found', 'Campaign tag not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.delete('/v1/campaign-tags/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tagId = c.req.param('id');
  const { data, error } = await supabase
    .from('campaign_tags')
    .delete()
    .eq('id', tagId)
    .eq('account_id', auth.accountId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to delete campaign tag: ${error.message}`);
  if (!data) notFound('tag_not_found', 'Campaign tag not found');
  return jsonResponse(c, { data: { id: data.id, deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/campaigns/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const campaign = await loadCampaignOrThrow(supabase, c.get('apiKey').accountId, c.req.param('id'));
  const tagsMap = await getTagsForCampaignIds(supabase, [campaign.id]);
  return jsonResponse(c, { data: attachTagsToCampaignRow(campaign, tagsMap) }, 200, c.get('rateLimitHeaders'));
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
  const tagIds = Array.isArray(body.tag_ids) ? body.tag_ids.filter((value): value is string => typeof value === 'string') : undefined;
  const addTagIds = Array.isArray(body.add_tag_ids) ? body.add_tag_ids.filter((value): value is string => typeof value === 'string') : [];
  const removeTagIds = Array.isArray(body.remove_tag_ids) ? body.remove_tag_ids.filter((value): value is string => typeof value === 'string') : [];
  if (tagIds !== undefined || addTagIds.length > 0 || removeTagIds.length > 0) {
    await applyCampaignTagPatch(supabase, auth.accountId, campaign.id, {
      tag_ids: tagIds,
      add_tag_ids: addTagIds,
      remove_tag_ids: removeTagIds,
    });
  }
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
  const tagsMap = await getTagsForCampaignIds(supabase, [refreshed.id]);
  return jsonResponse(c, { data: attachTagsToCampaignRow(refreshed, tagsMap) }, 200, c.get('rateLimitHeaders'));
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

app.post('/v1/campaigns/:id/enrollments/pause', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = Array.isArray(body.global_lead_ids)
    ? [...new Set(body.global_lead_ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  const { data, error } = await supabase.rpc('pause_enrollments_for_leads', {
    p_account_id: auth.accountId,
    p_campaign_id: campaign.id,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(`Failed to pause enrollments: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const scopeKey = stableGlobalLeadIdsKey(globalLeadIds);
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    operation: 'pause_enrollments',
    jobId: null,
    source: 'sync',
    counts: {
      paused: typeof result.paused === 'number' ? result.paused : 0,
      skipped: typeof result.skipped === 'number' ? result.skipped : 0,
      failed: 0,
    },
    globalLeadIds,
    syncScopeKey: `${campaign.id}:${scopeKey}`,
  });
  const queueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (queueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId }),
    }));
  }
  return jsonResponse(c, { data: result }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/enrollments/resume', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  if (campaign.status !== 'running') {
    invalidRequest('campaign_not_running', 'Campaign must be running to resume enrollments');
  }
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = Array.isArray(body.global_lead_ids)
    ? [...new Set(body.global_lead_ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  const { data, error } = await supabase.rpc('resume_enrollments_for_leads', {
    p_account_id: auth.accountId,
    p_campaign_id: campaign.id,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(`Failed to resume enrollments: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const scopeKey = stableGlobalLeadIdsKey(globalLeadIds);
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    operation: 'resume_enrollments',
    jobId: null,
    source: 'sync',
    counts: {
      resumed: typeof result.resumed === 'number' ? result.resumed : 0,
      skipped: typeof result.skipped === 'number' ? result.skipped : 0,
      failed: 0,
    },
    globalLeadIds,
    syncScopeKey: `${campaign.id}:${scopeKey}`,
  });
  const queueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (queueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId }),
    }));
  }
  return jsonResponse(c, { data: result }, 200, c.get('rateLimitHeaders'));
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
    phone_number: typeof lead.phone_number === 'string' ? lead.phone_number.trim() || null : null,
    mobile_phone_number:
      typeof lead.mobile_phone_number === 'string' ? lead.mobile_phone_number.trim() || null : null,
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
  const search = c.req.query('q')?.trim() || null;
  const sortRaw = c.req.query('sort')?.trim().toLowerCase() || 'created_at';
  const allowedSort = new Set([
    'email', 'name', 'first_name', 'last_name', 'company_name', 'website',
    'linkedin_url', 'company_linkedin_url', 'phone_number', 'mobile_phone_number', 'source', 'created_at',
  ]);
  const sort = allowedSort.has(sortRaw) ? sortRaw : 'created_at';
  const ascending = c.req.query('sort_dir')?.trim().toLowerCase() === 'asc';

  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .eq('campaign_id', campaign.id)
    .is('deleted_at', null);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(
      `email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},company_name.ilike.${pattern},phone_number.ilike.${pattern},mobile_phone_number.ilike.${pattern}`,
    );
  }
  const { data, error, count } = await query
    .order(sort, { ascending, nullsFirst: !ascending })
    .range(offset, offset + limit - 1);
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
  for (const key of [
    'name',
    'first_name',
    'last_name',
    'company_name',
    'website',
    'linkedin_url',
    'company_linkedin_url',
    'phone_number',
    'mobile_phone_number',
  ]) {
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
    supabase.from('leads').update({ deleted_at: now, updated_at: now }).eq('id', lead.id).is('deleted_at', null),
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
  let incomplete = 0;

  const { data: rpcResult, error: rpcError } = await supabase.rpc('import_api_leads_to_campaign', {
    p_account_id: auth.accountId,
    p_campaign_id: campaign.id,
    p_leads: rows as Json,
    p_options: { emit_row_webhooks: false },
  });
  if (rpcError) throw new Error(`Failed to bulk import leads: ${rpcError.message}`);

  const resultRow = (rpcResult ?? {}) as Record<string, unknown>;
  imported = (typeof resultRow.created === 'number' ? resultRow.created : 0)
    + (typeof resultRow.updated === 'number' ? resultRow.updated : 0);
  failed = typeof resultRow.failed === 'number' ? resultRow.failed : 0;
  incomplete = typeof resultRow.incomplete === 'number' ? resultRow.incomplete : 0;
  if (Array.isArray(resultRow.errors)) {
    for (const [index, entry] of (resultRow.errors as Array<Record<string, unknown>>).entries()) {
      errors.push({ index, message: String(entry.message ?? 'Import failed') });
    }
  }

  if (imported > 0 || failed > 0) {
    const eventId = await insertBatchCompletionWebhookEvent(supabase, {
      accountId: auth.accountId,
      campaignId: campaign.id,
      operation: 'api_lead_import',
      jobId: null,
      source: 'sync',
      counts: {
        created: typeof resultRow.created === 'number' ? resultRow.created : 0,
        updated: typeof resultRow.updated === 'number' ? resultRow.updated : 0,
        enrolled: typeof resultRow.enrolled === 'number' ? resultRow.enrolled : 0,
        skipped: typeof resultRow.skipped === 'number' ? resultRow.skipped : 0,
        incomplete,
        failed,
      },
      syncScopeKey: hashRequestBody(rawBody),
    });
    const queueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
    if (queueUrl) {
      await sqs.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ eventId }),
      }));
    }
  }

  const payload = { imported, incomplete, failed, errors };
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
      input: { operation: 'api_lead_import', leads: rows },
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

async function enqueueImportJobById(jobId: string): Promise<void> {
  const queueUrl = process.env.CLIENT_API_IMPORT_QUEUE_URL?.trim();
  if (!queueUrl) return;
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ jobId }),
  }));
}

app.post('/v1/jobs', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{
    operation?: string;
    campaign_id?: string | null;
    global_lead_ids?: string[];
    list_id?: string;
    leads?: Record<string, unknown>[];
  }>(await c.req.text());
  const job = await startApiImportJob(supabase, auth.accountId, auth.id, body);
  await enqueueImportJobById(job.id);
  return jsonResponse(c, { data: job }, 202, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/leads:add', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  if (globalLeadIds.length > BULK_SYNC_LIMIT) {
    invalidRequest('too_many_leads', `Sync add is limited to ${BULK_SYNC_LIMIT} leads`, 'global_lead_ids');
  }
  const { data, error } = await supabase.rpc('add_global_leads_to_campaign', {
    p_account_id: auth.accountId,
    p_campaign_id: campaign.id,
    p_global_lead_ids: globalLeadIds,
    p_options: { emit_row_webhooks: false },
  });
  if (error) throw new Error(`Failed to add leads to campaign: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    operation: 'add_to_campaign',
    jobId: null,
    source: 'sync',
    counts: {
      created: typeof result.created === 'number' ? result.created : 0,
      updated: typeof result.updated === 'number' ? result.updated : 0,
      enrolled: typeof result.enrolled === 'number' ? result.enrolled : 0,
      skipped: typeof result.skipped === 'number' ? result.skipped : 0,
      incomplete: typeof result.incomplete === 'number' ? result.incomplete : 0,
      failed: typeof result.failed === 'number' ? result.failed : 0,
    },
    globalLeadIds,
    syncScopeKey: `${campaign.id}:${stableGlobalLeadIdsKey(globalLeadIds)}`,
  });
  const webhookQueueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (webhookQueueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: webhookQueueUrl,
      MessageBody: JSON.stringify({ eventId }),
    }));
  }
  return jsonResponse(c, { data: result }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/campaigns/:id/leads:remove', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const campaign = await loadCampaignOrThrow(supabase, auth.accountId, c.req.param('id'));
  assertCampaignMutable(campaign);
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  if (globalLeadIds.length > BULK_SYNC_LIMIT) {
    invalidRequest('too_many_leads', `Sync remove is limited to ${BULK_SYNC_LIMIT} leads`, 'global_lead_ids');
  }
  const { data, error } = await supabase.rpc('remove_global_leads_from_campaign', {
    p_account_id: auth.accountId,
    p_campaign_id: campaign.id,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(`Failed to remove leads from campaign: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: campaign.id,
    operation: 'remove_from_campaign',
    jobId: null,
    source: 'sync',
    counts: {
      removed: typeof result.removed === 'number' ? result.removed : 0,
      skipped: typeof result.skipped === 'number' ? result.skipped : 0,
      failed: 0,
    },
    globalLeadIds,
    syncScopeKey: `${campaign.id}:${stableGlobalLeadIdsKey(globalLeadIds)}`,
  });
  const webhookQueueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (webhookQueueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: webhookQueueUrl,
      MessageBody: JSON.stringify({ eventId }),
    }));
  }
  return jsonResponse(c, { data: result }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/leads:remove-from-all-campaigns', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  if (globalLeadIds.length > BULK_SYNC_LIMIT) {
    invalidRequest('too_many_leads', `Sync remove is limited to ${BULK_SYNC_LIMIT} leads`, 'global_lead_ids');
  }
  const { data, error } = await supabase.rpc('remove_global_leads_from_all_campaigns', {
    p_account_id: auth.accountId,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(`Failed to remove leads from all campaigns: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
    accountId: auth.accountId,
    campaignId: null,
    operation: 'remove_from_all_campaigns',
    jobId: null,
    source: 'sync',
    counts: {
      removed: typeof result.removed === 'number' ? result.removed : 0,
      skipped: typeof result.skipped === 'number' ? result.skipped : 0,
      failed: 0,
    },
    globalLeadIds,
    syncScopeKey: stableGlobalLeadIdsKey(globalLeadIds),
  });
  const webhookQueueUrl = process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim();
  if (webhookQueueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: webhookQueueUrl,
      MessageBody: JSON.stringify({ eventId }),
    }));
  }
  return jsonResponse(c, { data: result }, 200, c.get('rateLimitHeaders'));
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

function parseCsvQueryIds(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function parseBoolQuery(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

app.get('/v1/people', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const search = c.req.query('q')?.trim() || null;
  const sortColumn = c.req.query('sort')?.trim() || 'latest_activity';
  const sortDirection = c.req.query('sort_dir')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  const { data, error } = await supabase.rpc('account_lead_people_page', {
    p_account_id: auth.accountId,
    p_global_lead_ids: parseCsvQueryIds(c.req.query('global_lead_ids')),
    p_campaign_ids: parseCsvQueryIds(c.req.query('campaign_ids')) as string[] | null,
    p_reply_statuses: parseCsvQueryIds(c.req.query('reply_statuses')),
    p_enrollment_states: parseCsvQueryIds(c.req.query('enrollment_states')),
    p_reply_categories: parseCsvQueryIds(c.req.query('reply_categories')),
    p_search: search,
    p_limit: limit,
    p_offset: offset,
    p_sort_column: sortColumn,
    p_sort_direction: sortDirection,
  });
  if (error) throw new Error(`Failed to list people: ${error.message}`);
  const rowsRaw = data ?? [];
  const totalCount =
    rowsRaw.length > 0 && rowsRaw[0].total_count != null ? Number(rowsRaw[0].total_count) : 0;
  return jsonResponse(c, buildListPayload(rowsRaw, limit, offset, totalCount), 200, c.get('rateLimitHeaders'));
});

app.get('/v1/people/:globalLeadId', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const globalLeadId = c.req.param('globalLeadId');
  const { data, error } = await supabase
    .from('account_lead_people')
    .select('*')
    .eq('account_id', auth.accountId)
    .eq('global_lead_id', globalLeadId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch person: ${error.message}`);
  if (!data) notFound('person_not_found', 'Person not found');
  const { data: memberships, error: membershipError } = await supabase
    .from('leads')
    .select('id, campaign_id, email, deleted_at, created_at')
    .eq('account_id', auth.accountId)
    .eq('global_lead_id', globalLeadId)
    .order('created_at', { ascending: false });
  if (membershipError) throw new Error(`Failed to fetch memberships: ${membershipError.message}`);
  return jsonResponse(c, { data: { person: data, memberships: memberships ?? [] } }, 200, c.get('rateLimitHeaders'));
});

app.patch('/v1/people/:globalLeadId', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const globalLeadId = c.req.param('globalLeadId');
  const body = parseJsonBody<{
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
  }>(await c.req.text());
  const { data: existing, error: existingError } = await supabase
    .from('account_lead_people')
    .select('global_lead_id')
    .eq('account_id', auth.accountId)
    .eq('global_lead_id', globalLeadId)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to load person: ${existingError.message}`);
  if (!existing) notFound('person_not_found', 'Person not found');

  const leadPatch = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.first_name !== undefined ? { first_name: body.first_name } : {}),
    ...(body.last_name !== undefined ? { last_name: body.last_name } : {}),
    ...(body.company_name !== undefined ? { company_name: body.company_name } : {}),
    updated_at: nowIso(),
  };
  if (Object.keys(leadPatch).length > 1) {
    await supabase
      .from('leads')
      .update(leadPatch as never)
      .eq('account_id', auth.accountId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
  }

  const peoplePatch = {
    ...(body.name !== undefined ? { display_name: body.name } : {}),
    ...(body.first_name !== undefined ? { first_name: body.first_name } : {}),
    ...(body.last_name !== undefined ? { last_name: body.last_name } : {}),
    ...(body.company_name !== undefined ? { company_list: body.company_name } : {}),
    updated_at: nowIso(),
  };
  if (Object.keys(peoplePatch).length > 1) {
    const { error: updateError } = await supabase
      .from('account_lead_people')
      .update(peoplePatch as never)
      .eq('account_id', auth.accountId)
      .eq('global_lead_id', globalLeadId);
    if (updateError) throw new Error(`Failed to update person: ${updateError.message}`);
  }

  const { data, error } = await supabase
    .from('account_lead_people')
    .select('*')
    .eq('account_id', auth.accountId)
    .eq('global_lead_id', globalLeadId)
    .single();
  if (error) throw new Error(`Failed to fetch updated person: ${error.message}`);
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/lead-lists', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .select('id, account_id, name, description, column_layout, created_at, updated_at')
    .eq('account_id', auth.accountId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to list lead lists: ${error.message}`);
  return jsonResponse(c, { data: data ?? [] }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/lead-lists', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ name?: string; description?: string | null; global_lead_ids?: string[] }>(
    await c.req.text(),
  );
  const name = body.name?.trim();
  if (!name) invalidRequest('missing_name', 'name is required', 'name');
  const { data: list, error } = await supabase
    .from('lead_saved_lists')
    .insert({
      account_id: auth.accountId,
      name,
      description: body.description?.trim() || null,
      column_layout: [],
    } as never)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create lead list: ${error.message}`);
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length > 0) {
    await supabase.from('lead_saved_list_members').insert(
      globalLeadIds.map((globalLeadId) => ({
        list_id: list.id,
        account_id: auth.accountId,
        global_lead_id: globalLeadId,
        source: 'manual',
      })) as never,
    );
  }
  return jsonResponse(c, { data: list }, 201, c.get('rateLimitHeaders'));
});

app.get('/v1/lead-lists/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .select('*')
    .eq('account_id', auth.accountId)
    .eq('id', c.req.param('id'))
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch lead list: ${error.message}`);
  if (!data) notFound('list_not_found', 'Lead list not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.patch('/v1/lead-lists/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ name?: string; description?: string | null; column_layout?: unknown }>(
    await c.req.text(),
  );
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.column_layout !== undefined) patch.column_layout = body.column_layout;
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .update(patch as never)
    .eq('account_id', auth.accountId)
    .eq('id', c.req.param('id'))
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update lead list: ${error.message}`);
  if (!data) notFound('list_not_found', 'Lead list not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.delete('/v1/lead-lists/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const listId = c.req.param('id');
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .delete()
    .eq('account_id', auth.accountId)
    .eq('id', listId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to delete lead list: ${error.message}`);
  if (!data) notFound('list_not_found', 'Lead list not found');
  return jsonResponse(c, { data: { id: data.id, deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/lead-lists/:id/people', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const listId = c.req.param('id');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const search = c.req.query('q')?.trim() || null;
  const { data, error } = await supabase.rpc('saved_lead_list_people_page', {
    p_account_id: auth.accountId,
    p_list_id: listId,
    p_search: search,
    p_reply_statuses: parseCsvQueryIds(c.req.query('reply_statuses')),
    p_enrollment_states: parseCsvQueryIds(c.req.query('enrollment_states')),
    p_reply_categories: parseCsvQueryIds(c.req.query('reply_categories')),
    p_limit: limit,
    p_offset: offset,
    p_sort_column: c.req.query('sort')?.trim() || 'latest_activity',
    p_sort_direction: c.req.query('sort_dir')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
  });
  if (error) throw new Error(`Failed to list lead list people: ${error.message}`);
  const rowsRaw = data ?? [];
  const totalCount =
    rowsRaw.length > 0 && rowsRaw[0].total_count != null ? Number(rowsRaw[0].total_count) : 0;
  return jsonResponse(c, buildListPayload(rowsRaw, limit, offset, totalCount), 200, c.get('rateLimitHeaders'));
});

app.post('/v1/lead-lists/:id/members', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const listId = c.req.param('id');
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  const { data: list, error: listError } = await supabase
    .from('lead_saved_lists')
    .select('id')
    .eq('account_id', auth.accountId)
    .eq('id', listId)
    .maybeSingle();
  if (listError) throw new Error(`Failed to load lead list: ${listError.message}`);
  if (!list) notFound('list_not_found', 'Lead list not found');

  const { data: existingMembers, error: existingError } = await supabase
    .from('lead_saved_list_members')
    .select('global_lead_id')
    .eq('account_id', auth.accountId)
    .eq('list_id', listId)
    .in('global_lead_id', globalLeadIds);
  if (existingError) throw new Error(`Failed to load list members: ${existingError.message}`);
  const existingSet = new Set((existingMembers ?? []).map((row) => row.global_lead_id as string));
  const toAdd = globalLeadIds.filter((id) => !existingSet.has(id));
  if (toAdd.length > 0) {
    const { error: insertError } = await supabase.from('lead_saved_list_members').insert(
      toAdd.map((globalLeadId) => ({
        list_id: listId,
        account_id: auth.accountId,
        global_lead_id: globalLeadId,
        source: 'manual',
      })) as never,
    );
    if (insertError) throw new Error(`Failed to add list members: ${insertError.message}`);
  }
  return jsonResponse(
    c,
    {
      data: {
        added: toAdd.length,
        skippedAlreadyMember: globalLeadIds.length - toAdd.length,
      },
    },
    200,
    c.get('rateLimitHeaders'),
  );
});

app.delete('/v1/lead-lists/:id/members', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const listId = c.req.param('id');
  const body = parseJsonBody<{ global_lead_ids?: string[] }>(await c.req.text());
  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  if (globalLeadIds.length === 0) {
    invalidRequest('missing_global_lead_ids', 'global_lead_ids must be a non-empty array', 'global_lead_ids');
  }
  const { data: removedRows, error } = await supabase
    .from('lead_saved_list_members')
    .delete()
    .eq('account_id', auth.accountId)
    .eq('list_id', listId)
    .in('global_lead_id', globalLeadIds)
    .select('global_lead_id');
  if (error) throw new Error(`Failed to remove list members: ${error.message}`);
  const removed = removedRows?.length ?? 0;
  return jsonResponse(
    c,
    { data: { removed, skippedNotMember: globalLeadIds.length - removed } },
    200,
    c.get('rateLimitHeaders'),
  );
});

app.get('/v1/mailbox-tags', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tags = await listAccountMailboxTags(supabase, auth.accountId);
  return jsonResponse(c, { data: tags }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/mailbox-tags', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const body = parseJsonBody<{ name?: string; color?: string | null }>(await c.req.text());
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) invalidRequest('validation_error', 'name is required');
  const { data, error } = await supabase
    .from('mailbox_tags')
    .insert({
      account_id: auth.accountId,
      name,
      color: body.color ?? null,
    })
    .select('id, name, color, created_at')
    .single();
  if (error) throw new Error(`Failed to create mailbox tag: ${error.message}`);
  return jsonResponse(c, { data }, 201, c.get('rateLimitHeaders'));
});

app.patch('/v1/mailbox-tags/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tagId = c.req.param('id');
  const body = parseJsonBody<{ name?: string; color?: string | null }>(await c.req.text());
  const updates: { name?: string; color?: string | null } = {};
  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (body.color !== undefined) updates.color = body.color;
  if (Object.keys(updates).length === 0) {
    invalidRequest('validation_error', 'No mutable fields provided');
  }
  const { data, error } = await supabase
    .from('mailbox_tags')
    .update(updates)
    .eq('id', tagId)
    .eq('account_id', auth.accountId)
    .select('id, name, color, created_at')
    .single();
  if (error) throw new Error(`Failed to update mailbox tag: ${error.message}`);
  if (!data) notFound('tag_not_found', 'Mailbox tag not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.delete('/v1/mailbox-tags/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const tagId = c.req.param('id');
  const { data, error } = await supabase
    .from('mailbox_tags')
    .delete()
    .eq('id', tagId)
    .eq('account_id', auth.accountId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to delete mailbox tag: ${error.message}`);
  if (!data) notFound('tag_not_found', 'Mailbox tag not found');
  return jsonResponse(c, { data: { id: data.id, deleted: true } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/mailboxes', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const tagIdsParam = c.req.query('tag_ids')?.trim();
  const tagFilterIds = tagIdsParam
    ? tagIdsParam.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  let query = supabase
    .from('mailboxes')
    .select('*', { count: 'exact' })
    .eq('account_id', auth.accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (tagFilterIds.length > 0) {
    const matchingIds = await getMailboxIdsMatchingAnyTag(supabase, auth.accountId, tagFilterIds);
    if (matchingIds.length === 0) {
      return jsonResponse(c, buildListPayload([], limit, offset, 0), 200, c.get('rateLimitHeaders'));
    }
    query = query.in('id', matchingIds);
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list mailboxes: ${error.message}`);
  const rows = data ?? [];
  const tagsMap = await getTagsForMailboxIds(
    supabase,
    rows.map((row) => row.id),
  );
  const enriched = rows.map((row) =>
    toPublicMailbox(attachTagsToMailboxRow(row as Record<string, unknown>, tagsMap)),
  );
  return jsonResponse(
    c,
    buildListPayload(enriched, limit, offset, count ?? 0),
    200,
    c.get('rateLimitHeaders')
  );
});

app.patch('/v1/mailboxes/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const mailbox = await loadMailboxOrThrow(supabase, auth.accountId, c.req.param('id'));
  const body = parseJsonBody<Record<string, unknown>>(await c.req.text());
  const tagIds = Array.isArray(body.tag_ids) ? body.tag_ids.filter((value): value is string => typeof value === 'string') : undefined;
  const addTagIds = Array.isArray(body.add_tag_ids) ? body.add_tag_ids.filter((value): value is string => typeof value === 'string') : [];
  const removeTagIds = Array.isArray(body.remove_tag_ids) ? body.remove_tag_ids.filter((value): value is string => typeof value === 'string') : [];
  if (tagIds === undefined && addTagIds.length === 0 && removeTagIds.length === 0) {
    invalidRequest('validation_error', 'No mutable fields provided');
  }
  await applyMailboxTagPatch(supabase, auth.accountId, mailbox.id, {
    tag_ids: tagIds,
    add_tag_ids: addTagIds,
    remove_tag_ids: removeTagIds,
  });
  const tagsMap = await getTagsForMailboxIds(supabase, [mailbox.id]);
  return jsonResponse(
    c,
    { data: toPublicMailbox(attachTagsToMailboxRow(mailbox as Record<string, unknown>, tagsMap)) },
    200,
    c.get('rateLimitHeaders'),
  );
});

app.get('/v1/mailboxes/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const mailbox = await loadMailboxOrThrow(supabase, auth.accountId, c.req.param('id'));
  const tagsMap = await getTagsForMailboxIds(supabase, [mailbox.id]);
  return jsonResponse(
    c,
    { data: toPublicMailbox(attachTagsToMailboxRow(mailbox as Record<string, unknown>, tagsMap)) },
    200,
    c.get('rateLimitHeaders'),
  );
});

app.get('/v1/threads', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const limit = parseIntQuery(c, 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parseIntQuery(c, 'offset', 0);
  const conversationStatusRaw = c.req.query('conversation_status')?.trim();
  const categoryRaw = c.req.query('category')?.trim();
  const hasReplyOnlyRaw = c.req.query('has_reply_only')?.trim();
  const { data, totalCount } = await listAccountThreads(supabase, {
    accountId: auth.accountId,
    limit,
    offset,
    campaignId: c.req.query('campaign_id')?.trim() || undefined,
    mailboxId: c.req.query('mailbox_id')?.trim() || undefined,
    unreadOnly: parseBoolQuery(c.req.query('unread_only')),
    conversationStatus:
      conversationStatusRaw === 'open' || conversationStatusRaw === 'closed'
        ? conversationStatusRaw
        : undefined,
    category: categoryRaw || undefined,
    tagIds: parseCsvQueryIds(c.req.query('tag_ids')) ?? undefined,
    dateFrom: c.req.query('date_from')?.trim() || undefined,
    dateTo: c.req.query('date_to')?.trim() || undefined,
    searchQuery: c.req.query('q')?.trim() || undefined,
    hasReplyOnly: hasReplyOnlyRaw ? parseBoolQuery(hasReplyOnlyRaw) : true,
  });
  return jsonResponse(c, buildListPayload(data, limit, offset, totalCount), 200, c.get('rateLimitHeaders'));
});

app.get('/v1/threads/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const data = await loadAccountThreadOrThrow(supabase, auth.accountId, c.req.param('id'));
  if (!data) notFound('thread_not_found', 'Thread not found');
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.patch('/v1/threads/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const existing = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!existing) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<{
    category?: string | null;
    conversation_status?: 'open' | 'closed';
    read?: boolean;
  }>(await c.req.text());
  if (
    body.category !== undefined
    && body.category !== null
    && !isValidThreadCategory(body.category)
  ) {
    invalidRequest(
      'invalid_category',
      `category must be one of: ${THREAD_CATEGORIES.join(', ')}`,
      'category',
    );
  }
  if (
    body.conversation_status !== undefined
    && body.conversation_status !== 'open'
    && body.conversation_status !== 'closed'
  ) {
    invalidRequest(
      'invalid_conversation_status',
      'conversation_status must be open or closed',
      'conversation_status',
    );
  }
  if (
    body.category === undefined
    && body.conversation_status === undefined
    && body.read !== true
  ) {
    invalidRequest('empty_update', 'At least one mutable field is required');
  }
  const interactionMetadata = parseSmartHandlingMetadata(existing.handling_metadata);
  await patchAccountThread(supabase, threadId, {
    category: body.category,
    conversationStatus: body.conversation_status,
    read: body.read,
  });
  if (body.category !== undefined) {
    await recordClientApiInboxInteraction(supabase, {
      auth,
      thread: existing as Database['public']['Tables']['email_threads']['Row'],
      action: 'thread.set_category',
      source: 'client_api',
      intent: buildInteractionIntent({
        metadata: interactionMetadata,
        categorySelection: body.category,
      }),
      changes: [{ field: 'category', from: existing.category, to: body.category }],
    });
  }
  if (body.conversation_status !== undefined) {
    await recordClientApiInboxInteraction(supabase, {
      auth,
      thread: existing as Database['public']['Tables']['email_threads']['Row'],
      action:
        body.conversation_status === 'closed'
          ? 'thread.close_conversation'
          : 'thread.reopen_conversation',
      source: 'client_api',
      intent:
        body.conversation_status === 'closed'
          ? buildInteractionIntent({
              metadata: interactionMetadata,
              actionId: 'close_conversation',
            })
          : null,
      changes: [
        {
          field: 'conversation_status',
          from: existing.conversation_status,
          to: body.conversation_status,
        },
      ],
    });
  }
  const data = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/threads/:id/messages', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, c.req.param('id'));
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
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<OutboundComposerBody & { in_reply_to_message_id?: string }>(await c.req.text());
  const targetMessage = body.in_reply_to_message_id?.trim()
    ? await loadThreadMessageOrThrow(supabase, threadId, body.in_reply_to_message_id.trim())
    : await loadLatestThreadMessage(supabase, threadId);
  if (!targetMessage) {
    invalidRequest('thread_empty', 'Thread has no messages to reply to');
  }
  const jobId = await createInboxReplyJob(supabase, {
    accountId: auth.accountId,
    threadId,
    inReplyToMessageId: targetMessage.id,
    body,
    targetMessage,
  });
  await recordClientApiInboxInteraction(supabase, {
    auth,
    thread: thread as Database['public']['Tables']['email_threads']['Row'],
    triggerMessage: targetMessage as Database['public']['Tables']['email_messages']['Row'],
    action: 'thread.reply_sent',
    source: 'client_api',
    intent: buildInteractionIntent({
      metadata: parseSmartHandlingMetadata(thread.handling_metadata),
      composedBody: body.body_text ?? body.body_html ?? '',
    }),
    changes: [{ field: 'reply_job_created', to: jobId }],
  });
  return jsonResponse(c, { data: { id: jobId } }, 202, c.get('rateLimitHeaders'));
});

app.post('/v1/threads/:id/forward', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<OutboundComposerBody & { forward_message_id?: string }>(await c.req.text());
  const forwardMessageId = body.forward_message_id?.trim();
  if (!forwardMessageId) {
    invalidRequest('missing_forward_message_id', 'forward_message_id is required', 'forward_message_id');
  }
  const forwardedMessage = await loadThreadMessageOrThrow(supabase, threadId, forwardMessageId);
  if (!forwardedMessage) {
    invalidRequest('message_not_found', 'forward_message_id was not found in this thread', 'forward_message_id');
  }
  if (!body.to_email?.trim()) {
    invalidRequest('missing_to_email', 'to_email is required for forwards', 'to_email');
  }
  const jobId = await createInboxForwardJob(supabase, {
    accountId: auth.accountId,
    threadId,
    forwardedMessageId: forwardMessageId,
    body,
    forwardedMessage,
  });
  await recordClientApiInboxInteraction(supabase, {
    auth,
    thread: thread as Database['public']['Tables']['email_threads']['Row'],
    triggerMessage: forwardedMessage as Database['public']['Tables']['email_messages']['Row'],
    action: 'thread.forward_sent',
    source: 'client_api',
    intent: buildInteractionIntent({
      metadata: parseSmartHandlingMetadata(thread.handling_metadata),
      composedBody: body.body_text ?? body.body_html ?? '',
    }),
    changes: [{ field: 'forward_job_created', to: jobId }],
  });
  return jsonResponse(c, { data: { id: jobId } }, 202, c.get('rateLimitHeaders'));
});

app.put('/v1/threads/:id/out-of-office', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<{ resume_at?: string | null; resume_mode?: string }>(await c.req.text());
  const resumeMode = body.resume_mode?.trim() || 'scheduled';
  if (resumeMode !== 'scheduled' && resumeMode !== 'instant' && resumeMode !== 'none') {
    invalidRequest(
      'invalid_resume_mode',
      'resume_mode must be scheduled, instant, or none',
      'resume_mode',
    );
  }
  try {
    const result = await saveThreadOutOfOffice(supabase, threadId, {
      resumeAt: body.resume_at ?? null,
      resumeMode,
    });
    const data = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
    return jsonResponse(c, { data: { thread: data, result } }, 200, c.get('rateLimitHeaders'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update out-of-office';
    if (message.includes('resume_at is required')) {
      invalidRequest('missing_resume_at', message, 'resume_at');
    }
    throw error;
  }
});

app.delete('/v1/threads/:id/out-of-office', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  await clearThreadOutOfOffice(supabase, threadId);
  const data = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  return jsonResponse(c, { data }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/threads/:id/replace-lead', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const leadId = typeof thread.lead_id === 'string' ? thread.lead_id : null;
  if (!leadId) {
    invalidRequest('thread_missing_lead', 'Thread has no lead to replace');
  }
  const body = parseJsonBody<{
    new_email?: string;
    new_name?: string | null;
    new_first_name?: string | null;
    new_last_name?: string | null;
    new_phone_number?: string | null;
    reason?: string | null;
    reason_note?: string | null;
    source_message_id?: string | null;
    forward_message_id?: string | null;
  }>(await c.req.text());
  const newEmail = body.new_email?.trim().toLowerCase();
  if (!newEmail) {
    invalidRequest('missing_new_email', 'new_email is required', 'new_email');
  }
  const { data: replacementRows, error } = await supabase.rpc('replace_lead_with_new_contact', {
    p_old_lead_id: leadId,
    p_new_email: newEmail,
    p_new_name: body.new_name?.trim() || null,
    p_new_first_name: body.new_first_name?.trim() || null,
    p_new_last_name: body.new_last_name?.trim() || null,
    p_new_phone_number: body.new_phone_number?.trim() || null,
    p_reason: (body.reason?.trim() || 'manual_referral') as Database['public']['Enums']['replacement_reason_enum'],
    p_reason_note: body.reason_note?.trim() || null,
    p_source_message_id: body.source_message_id?.trim() || null,
  });
  if (error) throw new Error(`Failed to replace lead: ${error.message}`);
  const replacement = Array.isArray(replacementRows) ? replacementRows[0] : null;
  if (!replacement?.new_lead_id || !replacement?.replacement_id) {
    throw new Error('Failed to replace lead: no replacement result returned');
  }
  let forwardJobId: string | null = null;
  const forwardMessageId = body.forward_message_id?.trim();
  if (forwardMessageId) {
    const refreshedThread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
    if (!refreshedThread) notFound('thread_not_found', 'Thread not found');
    const forwardedMessage = await loadThreadMessageOrThrow(supabase, threadId, forwardMessageId);
    if (!forwardedMessage) {
      invalidRequest('message_not_found', 'forward_message_id was not found in this thread', 'forward_message_id');
    }
    forwardJobId = await createInboxForwardJob(supabase, {
      accountId: auth.accountId,
      threadId,
      forwardedMessageId: forwardMessageId,
      body: {
        to_email: newEmail,
        to_name: body.new_name?.trim() || undefined,
        body_text: 'Forwarding the original message.',
        body_html: 'Forwarding the original message.',
      },
      forwardedMessage,
    });
  }
  return jsonResponse(c, {
    data: {
      replacement_id: replacement.replacement_id,
      new_lead_id: replacement.new_lead_id,
      enrollment_id: replacement.enrollment_id ?? null,
      forward_job_id: forwardJobId,
    },
  }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/thread-tags', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const { data, error } = await supabase
    .from('thread_tags')
    .select('*')
    .eq('account_id', auth.accountId)
    .order('name');
  if (error) throw new Error(`Failed to list thread tags: ${error.message}`);
  return jsonResponse(c, { data: data ?? [] }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/threads/:id/tags:add', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<{ tag_id?: string }>(await c.req.text());
  const tagId = body.tag_id?.trim();
  if (!tagId) invalidRequest('missing_tag_id', 'tag_id is required', 'tag_id');
  const { data: tag, error: tagError } = await supabase
    .from('thread_tags')
    .select('id')
    .eq('id', tagId)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (tagError) throw new Error(`Failed to fetch thread tag: ${tagError.message}`);
  if (!tag) notFound('thread_tag_not_found', 'Thread tag not found');
  const { error } = await supabase.from('thread_tag_assignments').insert({
    thread_id: threadId,
    tag_id: tagId,
    account_id: auth.accountId,
  });
  if (error) throw new Error(`Failed to add tag to thread: ${error.message}`);
  return jsonResponse(c, { data: { thread_id: threadId, tag_id: tagId } }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/threads/:id/tags:remove', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const threadId = c.req.param('id');
  const thread = await loadAccountThreadOrThrow(supabase, auth.accountId, threadId);
  if (!thread) notFound('thread_not_found', 'Thread not found');
  const body = parseJsonBody<{ tag_id?: string }>(await c.req.text());
  const tagId = body.tag_id?.trim();
  if (!tagId) invalidRequest('missing_tag_id', 'tag_id is required', 'tag_id');
  const { error } = await supabase
    .from('thread_tag_assignments')
    .delete()
    .eq('thread_id', threadId)
    .eq('tag_id', tagId);
  if (error) throw new Error(`Failed to remove tag from thread: ${error.message}`);
  return jsonResponse(c, { data: { thread_id: threadId, tag_id: tagId, removed: true } }, 200, c.get('rateLimitHeaders'));
});

app.get('/v1/message-jobs/:id', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const job = await loadAccountMessageJobOrThrow(supabase, auth.accountId, c.req.param('id'));
  if (!job) notFound('message_job_not_found', 'Message job not found');
  return jsonResponse(c, { data: toPublicMessageJob(job) }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/message-jobs/:id/cancel', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const job = await loadAccountMessageJobOrThrow(supabase, auth.accountId, c.req.param('id'));
  if (!job) notFound('message_job_not_found', 'Message job not found');
  try {
    await cancelAccountMessageJob(supabase, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Message job could not be cancelled';
    invalidRequest('cancel_failed', message);
  }
  const refreshed = await loadAccountMessageJobOrThrow(supabase, auth.accountId, job.id);
  return jsonResponse(c, { data: toPublicMessageJob(refreshed!) }, 200, c.get('rateLimitHeaders'));
});

app.post('/v1/message-jobs/:id/send-now', async (c) => {
  const supabase = createServiceRoleClient();
  const auth = c.get('apiKey');
  const job = await loadAccountMessageJobOrThrow(supabase, auth.accountId, c.req.param('id'));
  if (!job) notFound('message_job_not_found', 'Message job not found');
  try {
    await sendAccountMessageJobNow(supabase, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Message job could not be sent immediately';
    invalidRequest('send_now_failed', message);
  }
  const refreshed = await loadAccountMessageJobOrThrow(supabase, auth.accountId, job.id);
  return jsonResponse(c, { data: toPublicMessageJob(refreshed!) }, 200, c.get('rateLimitHeaders'));
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

app.post('/internal/webhook/test', async (c) => {
  const supabase = createServiceRoleClient();
  const body = parseJsonBody<{
    accountId?: string;
    campaignId?: string | null;
    url?: string;
    signingSecret?: string;
    eventType?: string;
  }>(await c.req.text());
  const accountId = body.accountId?.trim();
  const userId = (c as any).get('userId') as string;
  if (!accountId) invalidRequest('missing_fields', 'accountId is required');

  const { data: membership, error: membershipError } = await supabase
    .from('account_users')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Failed to verify membership: ${membershipError.message}`);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    forbidden('account_admin_required', 'Only account owners and admins can send test webhooks');
  }

  const campaignId = body.campaignId?.trim() || null;
  const eventType = (body.eventType?.trim() || 'email.sent') as string;
  if (!isAllowedWebhookEventType(eventType)) {
    invalidRequest('invalid_event_type', `Unsupported webhook event type: ${eventType}`);
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('webhook_url, webhook_signing_secret')
    .eq('id', accountId)
    .maybeSingle();
  if (accountError) throw new Error(`Failed to load account webhook settings: ${accountError.message}`);
  if (!account) notFound('account_not_found', 'Account not found');

  let endpointUrl = body.url?.trim() || '';
  let signingSecret = body.signingSecret?.trim() || '';

  if (campaignId) {
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('webhook_url_override, webhook_signing_secret_override, account_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (campaignError) throw new Error(`Failed to load campaign webhook settings: ${campaignError.message}`);
    if (!campaign || campaign.account_id !== accountId) {
      notFound('campaign_not_found', 'Campaign not found in this account');
    }
    if (!endpointUrl) endpointUrl = (campaign.webhook_url_override || account.webhook_url || '').trim();
    if (!signingSecret) {
      signingSecret = (campaign.webhook_signing_secret_override || account.webhook_signing_secret || '').trim();
    }
  } else {
    if (!endpointUrl) endpointUrl = (account.webhook_url || '').trim();
    if (!signingSecret) signingSecret = (account.webhook_signing_secret || '').trim();
  }

  if (!endpointUrl) invalidRequest('missing_webhook_url', 'Webhook URL is required');
  if (!isValidHttpsWebhookUrl(endpointUrl)) {
    invalidRequest('invalid_webhook_url', 'Webhook URL must use HTTPS');
  }

  const testPayload = buildWebhookTestPayload(eventType, { accountId, campaignId });
  const result = await deliverWebhookPost({
    endpointUrl,
    signingSecret: signingSecret || undefined,
    eventType,
    payload: testPayload,
  });

  return jsonResponse(c, {
    data: {
      success: result.ok,
      status: result.status,
      response_body: result.responseBody.slice(0, 2000),
      event_type: eventType,
      request_body: JSON.parse(result.requestBody) as Record<string, unknown>,
    },
  }, result.ok ? 200 : 422);
});

app.post('/internal/import-jobs/:id/enqueue', async (c) => {
  const supabase = createServiceRoleClient();
  const jobId = c.req.param('id');
  const userId = (c as any).get('userId') as string;

  const { data: job, error: jobError } = await supabase
    .from('api_import_jobs')
    .select('id, account_id, status, input')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Failed to load import job: ${jobError.message}`);
  if (!job) notFound('job_not_found', 'Import job not found');

  const { data: membership, error: membershipError } = await supabase
    .from('account_users')
    .select('role')
    .eq('account_id', job.account_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Failed to verify membership: ${membershipError.message}`);
  if (!membership) {
    forbidden('account_member_required', 'Account membership is required to enqueue import jobs');
  }

  const input = (job.input && typeof job.input === 'object' ? job.input : {}) as Record<string, unknown>;
  const operation = typeof input.operation === 'string' ? input.operation : null;

  if (operation === 'export_leads') {
    const stateMachineArn = process.env.LEADS_EXPORT_STATE_MACHINE_ARN?.trim();
    if (!stateMachineArn) {
      throw new Error('LEADS_EXPORT_STATE_MACHINE_ARN is not configured.');
    }
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify({ jobId: job.id }),
      }),
    );
    return jsonResponse(c, { data: { id: job.id, enqueued: true } }, 202);
  }

  const queueUrl = process.env.CLIENT_API_IMPORT_QUEUE_URL?.trim();
  if (queueUrl) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ jobId: job.id }),
    }));
  }

  return jsonResponse(c, { data: { id: job.id, enqueued: Boolean(queueUrl) } }, 202);
});
