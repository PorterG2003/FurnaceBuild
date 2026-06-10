import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildCategorizerPrompt,
  parseCategorizerResponse,
  DEFAULT_CATEGORIZER_MODEL,
  type CategorizerCategory,
} from '../../../lib/categorizer/index';

/**
 * Categorizer preview: classifies a campaign's existing replies with the same
 * prompt/model the scheduler uses, WITHOUT writing categories anywhere.
 * Read-only - powers the builder's CategorizerPreviewModal.
 *
 * POST { campaignId, replies: [{ threadId, subject, bodyText, receivedAt }] }
 * -> { predictions: [{ threadId, category, returnDate } | { threadId, error }] }
 */

const MAX_PREVIEW_REPLIES = 20;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface PreviewReplyInput {
  threadId: string;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string | null;
}

interface PreviewPrediction {
  threadId: string;
  category?: CategorizerCategory;
  returnDate?: string | null;
  error?: string;
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function assertUserCanAccessCampaign(
  db: SupabaseClient,
  userId: string,
  campaignId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data: campaign, error } = await db
    .from('campaigns')
    .select('id, account_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Database error loading campaign', details: error.message },
    };
  }
  if (!campaign) {
    return { ok: false, status: 404, body: { error: 'Campaign not found', code: 'NO_CAMPAIGN' } };
  }
  const { data: membership } = await db
    .from('account_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('account_id', campaign.account_id as string)
    .maybeSingle();
  if (!membership) {
    return { ok: false, status: 403, body: { error: 'Forbidden', code: 'CAMPAIGN_ACCESS_DENIED' } };
  }
  return { ok: true };
}

async function classifyOne(
  apiKey: string,
  model: string,
  reply: PreviewReplyInput,
): Promise<PreviewPrediction> {
  const messageDate = reply.receivedAt ? new Date(reply.receivedAt) : new Date();
  const { system, user } = buildCategorizerPrompt({
    subject: reply.subject,
    bodyText: reply.bodyText,
    messageDate: Number.isNaN(messageDate.getTime()) ? new Date() : messageDate,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 256,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    return {
      threadId: reply.threadId,
      error: err instanceof Error ? err.message : 'LLM request failed',
    };
  } finally {
    clearTimeout(timeout);
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errField = body.error as { message?: string } | string | undefined;
    const details =
      (typeof errField === 'string' ? errField : errField?.message) || `HTTP ${res.status}`;
    return { threadId: reply.threadId, error: details };
  }

  const choices = body.choices as Array<{ message?: { content?: string | null } }> | undefined;
  const text = choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return { threadId: reply.threadId, error: 'Empty model response' };
  }

  const classification = parseCategorizerResponse(text);
  if (!classification) {
    return { threadId: reply.threadId, error: 'Unparseable model response' };
  }

  return {
    threadId: reply.threadId,
    category: classification.category,
    returnDate: classification.returnDate,
  };
}

export const handler = async (event: unknown) => {
  try {
    return await handleRequest(event as Record<string, unknown>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[categorizerPreview] unhandled', err);
    return response(500, { error: 'Internal error', details: message, code: 'UNHANDLED' });
  }
};

async function handleRequest(event: Record<string, unknown>) {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  const model = process.env.OPENROUTER_CATEGORIZER_MODEL?.trim() || DEFAULT_CATEGORIZER_MODEL;

  if (!supabaseUrl || !supabaseSecretKey || !openRouterApiKey) {
    return response(500, { error: 'Missing environment configuration' });
  }

  const method = (event.requestContext as { http?: { method?: string } } | undefined)?.http?.method
    ?? (event as { httpMethod?: string }).httpMethod
    ?? 'POST';
  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  const headers = (event.headers ?? {}) as Record<string, string>;
  const authHeader = headers.authorization || headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return response(401, { error: 'Missing authorization token' });
  }

  const db = createClient(supabaseUrl, supabaseSecretKey);
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) {
    return response(401, { error: 'Invalid token' });
  }

  let rawBody: unknown;
  try {
    const b = (event as { body?: string }).body;
    rawBody = JSON.parse(typeof b === 'string' ? b : JSON.stringify(b ?? {}));
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }
  if (!rawBody || typeof rawBody !== 'object') {
    return response(400, { error: 'Invalid JSON body' });
  }
  const body = rawBody as Record<string, unknown>;

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
  if (!campaignId) {
    return response(400, { error: 'Missing campaignId' });
  }

  const access = await assertUserCanAccessCampaign(db, user.id, campaignId);
  if (!access.ok) {
    return response(access.status, access.body);
  }

  const repliesRaw = Array.isArray(body.replies) ? body.replies : [];
  const replies: PreviewReplyInput[] = repliesRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      threadId: typeof r.threadId === 'string' ? r.threadId : '',
      subject: typeof r.subject === 'string' ? r.subject : null,
      bodyText: typeof r.bodyText === 'string' ? r.bodyText : null,
      receivedAt: typeof r.receivedAt === 'string' ? r.receivedAt : null,
    }))
    .filter((r) => r.threadId)
    .slice(0, MAX_PREVIEW_REPLIES);

  if (replies.length === 0) {
    return response(400, { error: 'No replies to classify', code: 'NO_REPLIES' });
  }

  const predictions = await Promise.all(
    replies.map((reply) => classifyOne(openRouterApiKey, model, reply)),
  );

  return response(200, { predictions, model });
}
