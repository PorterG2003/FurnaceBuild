import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enrichPerson } from '../../../lib/apollo/apolloClient';
import { mapApolloToProfile, type ApolloProfileSuggestion } from '../../../lib/apollo/mapApolloToProfile';
import {
  APOLLO_ENRICHMENT_SESSION_EXPIRY_MINUTES,
  type ApolloEnrichmentSessionStatus,
} from '../../../lib/apollo/enrichmentSessionTypes';
import {
  buildApolloWebhookUrl,
  extractApolloWebhookPhones,
  isUniqueViolation,
  parseApolloWebhookSessionPath,
  resolveFunctionUrlBase,
  verifyApolloWebhookSignature,
} from '../../../lib/apollo/apolloEnrichRoutes';

const APOLLO_METER = 'apollo_enrichment';

function isFunctionUrlEvent(event: unknown): event is {
  headers: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  rawPath?: string;
  requestContext?: { domainName?: string; http?: { method?: string; path?: string } };
  httpMethod?: string;
} {
  return Boolean(event && typeof event === 'object' && event !== null && 'headers' in event);
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const requestBodySchema = z.object({
  accountId: z.string().uuid(),
  globalLeadId: z.string().min(1).max(256),
});

interface BalanceRow {
  used: number;
  remaining: number;
  credit_limit: number;
}

async function assertAccountMember(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('account_users')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .limit(1);
  if (error) {
    console.error('[apolloEnrich] account_users query failed', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function loadLeadContact(
  supabase: SupabaseClient,
  accountId: string,
  globalLeadId: string,
): Promise<{ found: boolean; email: string | null; linkedinUrl: string | null }> {
  const { data, error } = await supabase
    .from('leads')
    .select('email, linkedin_url, created_at')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load lead: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ email: string | null; linkedin_url: string | null }>;
  if (rows.length === 0) {
    return { found: false, email: null, linkedinUrl: null };
  }
  const email = rows.find((r) => r.email && r.email.trim() !== '')?.email ?? null;
  const linkedinUrl =
    rows.find((r) => r.linkedin_url && r.linkedin_url.trim() !== '')?.linkedin_url ?? null;
  return { found: true, email, linkedinUrl };
}

async function readBalance(
  supabase: SupabaseClient,
  accountId: string,
): Promise<BalanceRow> {
  const { data, error } = await supabase.rpc('get_credit_balance', {
    p_account_id: accountId,
    p_meter: APOLLO_METER,
  });
  if (error) {
    throw new Error(`Failed to read credit balance: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as BalanceRow | undefined;
  return row ?? { used: 0, remaining: 0, credit_limit: 0 };
}

async function expireStalePendingSessions(
  supabase: SupabaseClient,
  accountId: string,
  globalLeadId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('apollo_enrichment_sessions')
    .update({ status: 'expired' satisfies ApolloEnrichmentSessionStatus })
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .eq('status', 'pending_phone')
    .lte('expires_at', now);
  if (error) {
    console.error('[apolloEnrich] expire stale sessions failed', error.message);
  }
}

async function findActivePendingSession(
  supabase: SupabaseClient,
  accountId: string,
  globalLeadId: string,
): Promise<{ id: string } | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('apollo_enrichment_sessions')
    .select('id')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .eq('status', 'pending_phone')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[apolloEnrich] pending session lookup failed', error.message);
    return null;
  }
  const row = (data ?? [])[0] as { id: string } | undefined;
  return row ?? null;
}

async function updateSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: ApolloEnrichmentSessionStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('apollo_enrichment_sessions')
    .update({ status, ...extra })
    .eq('id', sessionId);
  if (error) {
    console.error('[apolloEnrich] session update failed', sessionId, status, error.message);
  }
}

function sessionExpiresAt(): string {
  return new Date(Date.now() + APOLLO_ENRICHMENT_SESSION_EXPIRY_MINUTES * 60_000).toISOString();
}

async function handleWebhook(
  event: {
    headers: Record<string, string | undefined>;
    body?: string | null;
    isBase64Encoded?: boolean;
    rawPath?: string;
    requestContext?: { http?: { path?: string } };
  },
  supabase: SupabaseClient,
): Promise<{ statusCode: number; body: unknown }> {
  const rawPath = event.rawPath ?? event.requestContext?.http?.path ?? '';
  const sessionId = parseApolloWebhookSessionPath(rawPath);
  if (!sessionId) {
    return response(404, { ok: false, error: 'Not found' });
  }

  const rawBody =
    typeof event.body === 'string'
      ? event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body
        : '{}'
      : '{}';

  const signature =
    event.headers?.['x-apollo-signature'] ??
    event.headers?.['X-Apollo-Signature'] ??
    event.headers?.['x-apollo-webhook-signature'] ??
    event.headers?.['X-Apollo-Webhook-Signature'];

  const secret = process.env.APOLLO_WEBHOOK_SECRET;
  if (!verifyApolloWebhookSignature(rawBody, signature, secret)) {
    return response(401, { ok: false, error: 'Invalid webhook signature' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return response(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { data: session, error: loadError } = await supabase
    .from('apollo_enrichment_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .limit(1)
    .maybeSingle();

  if (loadError || !session) {
    return response(404, { ok: false, error: 'Session not found' });
  }

  const phones = extractApolloWebhookPhones(payload);
  const hasPhone = phones.some(
    (p) => (p.sanitized_number && p.sanitized_number.trim() !== '') || (p.raw_number && p.raw_number.trim() !== ''),
  );
  const nextStatus: ApolloEnrichmentSessionStatus = hasPhone ? 'complete' : 'no_phone';

  const { error: updateError } = await supabase
    .from('apollo_enrichment_sessions')
    .update({
      status: nextStatus,
      phone_numbers: phones,
    })
    .eq('id', sessionId);

  if (updateError) {
    console.error('[apolloEnrich] webhook session update failed', updateError.message);
    return response(500, { ok: false, error: 'Failed to update session' });
  }

  return response(200, { ok: true, sessionId, status: nextStatus });
}

async function handleEnrich(
  event: {
    headers: Record<string, string | undefined>;
    body?: string | null;
    isBase64Encoded?: boolean;
    requestContext?: { domainName?: string };
  },
  supabase: SupabaseClient,
  apolloApiKey: string,
  functionBaseUrl: string,
): Promise<{ statusCode: number; body: unknown }> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return response(401, { ok: false, error: 'Missing authorization token' });
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return response(401, { ok: false, error: 'Invalid token' });
  }

  const rawBody =
    typeof event.body === 'string'
      ? event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body
        : '{}'
      : '{}';

  let parsed: z.infer<typeof requestBodySchema>;
  try {
    const json = JSON.parse(rawBody) as unknown;
    const r = requestBodySchema.safeParse(json);
    if (!r.success) {
      return response(400, { ok: false, error: 'Invalid request body', details: r.error.flatten() });
    }
    parsed = r.data;
  } catch {
    return response(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { accountId, globalLeadId } = parsed;

  const isMember = await assertAccountMember(supabase, accountId, user.id);
  if (!isMember) {
    return response(403, { ok: false, error: 'Access denied' });
  }

  const contact = await loadLeadContact(supabase, accountId, globalLeadId);
  if (!contact.found) {
    return response(404, { ok: false, error: 'Lead not found' });
  }
  if (!contact.email && !contact.linkedinUrl) {
    return response(422, {
      ok: false,
      error: 'This lead has no email or LinkedIn URL to enrich from.',
      code: 'NO_MATCH_KEY',
    });
  }

  await expireStalePendingSessions(supabase, accountId, globalLeadId);

  const balanceBefore = await readBalance(supabase, accountId);
  if (balanceBefore.remaining <= 0) {
    return response(402, {
      ok: false,
      error: 'No enrichment credits remaining this month.',
      code: 'NO_CREDITS',
      creditsRemaining: 0,
      creditLimit: balanceBefore.credit_limit,
    });
  }

  const expiresAt = sessionExpiresAt();
  const { data: inserted, error: insertError } = await supabase
    .from('apollo_enrichment_sessions')
    .insert({
      account_id: accountId,
      global_lead_id: globalLeadId,
      created_by: user.id,
      status: 'pending_phone' satisfies ApolloEnrichmentSessionStatus,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const pending = await findActivePendingSession(supabase, accountId, globalLeadId);
      if (pending) {
        return response(409, {
          ok: false,
          error: 'An enrichment is already in progress for this lead.',
          code: 'PHONE_ENRICH_PENDING',
          sessionId: pending.id,
        });
      }
    }
    console.error('[apolloEnrich] session insert failed', insertError.message);
    return response(500, { ok: false, error: 'Failed to start enrichment session' });
  }

  const sessionId = (inserted as { id: string }).id;
  const webhookUrl = buildApolloWebhookUrl(functionBaseUrl, sessionId);

  let person;
  try {
    person = await enrichPerson(
      {
        email: contact.email,
        linkedinUrl: contact.linkedinUrl,
        revealPhoneNumber: true,
        webhookUrl,
      },
      { apiKey: apolloApiKey },
    );
  } catch (err) {
    console.error('[apolloEnrich] Apollo call failed', err);
    await updateSessionStatus(supabase, sessionId, 'failed');
    await supabase.rpc('consume_credit', {
      p_account_id: accountId,
      p_meter: APOLLO_METER,
      p_amount: 0,
      p_reason: 'apollo_error',
      p_ref_type: 'global_lead',
      p_ref_id: globalLeadId,
      p_created_by: user.id,
      p_metadata: { session_id: sessionId },
    });
    return response(502, { ok: false, error: 'Contact lookup failed', code: 'APOLLO_UPSTREAM' });
  }

  if (!person) {
    await updateSessionStatus(supabase, sessionId, 'no_match');
    await supabase.rpc('consume_credit', {
      p_account_id: accountId,
      p_meter: APOLLO_METER,
      p_amount: 0,
      p_reason: 'apollo_no_match',
      p_ref_type: 'global_lead',
      p_ref_id: globalLeadId,
      p_created_by: user.id,
      p_metadata: { session_id: sessionId },
    });
    return response(200, {
      ok: true,
      match: false,
      sessionId,
      creditsRemaining: balanceBefore.remaining,
      creditLimit: balanceBefore.credit_limit,
    });
  }

  const suggestion = mapApolloToProfile(person);

  const { data: consumeData, error: consumeError } = await supabase.rpc('consume_credit', {
    p_account_id: accountId,
    p_meter: APOLLO_METER,
    p_amount: 1,
    p_reason: 'apollo_person_match',
    p_ref_type: 'global_lead',
    p_ref_id: globalLeadId,
    p_created_by: user.id,
    p_metadata: { matched: true, session_id: sessionId },
  });

  if (consumeError) {
    await updateSessionStatus(supabase, sessionId, 'failed');
    if (consumeError.message?.includes('INSUFFICIENT_CREDITS')) {
      return response(402, {
        ok: false,
        error: 'No enrichment credits remaining this month.',
        code: 'NO_CREDITS',
        creditsRemaining: 0,
        creditLimit: balanceBefore.credit_limit,
      });
    }
    console.error('[apolloEnrich] consume_credit failed', consumeError.message);
    return response(500, { ok: false, error: 'Failed to record credit usage' });
  }

  await supabase
    .from('apollo_enrichment_sessions')
    .update({ sync_suggestion: suggestion satisfies ApolloProfileSuggestion })
    .eq('id', sessionId);

  const consumeRow = (Array.isArray(consumeData) ? consumeData[0] : consumeData) as
    | BalanceRow
    | undefined;

  return response(200, {
    ok: true,
    match: true,
    sessionId,
    phonePending: true,
    suggestion,
    creditsRemaining: consumeRow?.remaining ?? balanceBefore.remaining - 1,
    creditLimit: consumeRow?.credit_limit ?? balanceBefore.credit_limit,
  });
}

export const handler = async (event: unknown) => {
  try {
    if (!isFunctionUrlEvent(event)) {
      return response(500, { ok: false, error: 'Unsupported invocation' });
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
    const apolloApiKey = process.env.APOLLO_API_KEY ?? '';

    if (!supabaseUrl || !supabaseSecretKey || !apolloApiKey) {
      return response(500, { ok: false, error: 'Missing server configuration' });
    }

    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
    if (method !== 'POST') {
      return response(405, { ok: false, error: 'Method not allowed' });
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);
    const rawPath = event.rawPath ?? event.requestContext?.http?.path ?? '/';
    const webhookSessionId = parseApolloWebhookSessionPath(rawPath);

    if (webhookSessionId) {
      return handleWebhook(event, supabase);
    }

    const functionBaseUrl = resolveFunctionUrlBase(event);
    if (!functionBaseUrl) {
      return response(500, { ok: false, error: 'Could not resolve Function URL base' });
    }

    return handleEnrich(event, supabase, apolloApiKey, functionBaseUrl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[apolloEnrich] unhandled', err);
    return response(500, { ok: false, error: 'Internal error', details: message });
  }
};
