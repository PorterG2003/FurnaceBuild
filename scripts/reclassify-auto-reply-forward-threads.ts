import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { detectAutoReplyRedirectSignals } from '../lib/inbox/autoReplyRedirectDetection.js';
import {
  buildSuggestedReferralFromExtraction,
  extractReferralContactHeuristic,
  referralHasHighConfidenceName,
} from '../lib/inbox/referralContactExtraction.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveAmplifySecretParamPathForTarget,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const OOO_PRIMARY_ACTIONS = new Set([
  'mark_ooo_dated',
  'mark_ooo_month',
  'mark_ooo_instant',
  'mark_ooo_custom',
]);

type CandidateThreadRow = {
  id: string;
  account_id: string;
  lead_id: string | null;
  conversation_status: string;
  classification_status: string;
  last_message_at: string | null;
  handling_metadata: Record<string, unknown> | null;
};

type LeadRow = {
  id: string;
  email: string | null;
};

type ReceivedMessageRow = {
  id: string;
  thread_id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  created_at: string;
};

type AffectedThread = {
  threadId: string;
  accountId: string;
  leadEmail: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  conversationStatus: string;
  lastMessageAt: string | null;
  bodyText: string;
  headerMismatch: boolean;
};

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function previewText(value: string | null): string | null {
  if (!value) return null;
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

function getPrimaryAction(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const primary = metadata.primary;
  if (!primary || typeof primary !== 'object' || Array.isArray(primary)) return null;
  return typeof primary.action === 'string' ? primary.action : null;
}

function getSuggestedReferral(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const referral = metadata.suggested_referral;
  if (!referral || typeof referral !== 'object' || Array.isArray(referral)) return null;
  return referral as Record<string, unknown>;
}

function shouldIncludeThread(
  thread: CandidateThreadRow,
  redirect: ReturnType<typeof detectAutoReplyRedirectSignals>,
): boolean {
  if (!redirect.shouldReplaceLead) return false;

  const primaryAction = getPrimaryAction(thread.handling_metadata);
  if (OOO_PRIMARY_ACTIONS.has(primaryAction ?? '')) return true;
  if (primaryAction === 'replace_lead' && !referralHasHighConfidenceName(getSuggestedReferral(thread.handling_metadata))) {
    return true;
  }
  return false;
}

async function resolveSupabaseAdminClient(): Promise<{
  targetEnv: 'prod' | 'dev';
  urlSource: string;
  secretParamPath: string | null;
  supabase: SupabaseClient;
}> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[reclassify-auto-reply-forward-threads] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.',
    );
  }

  const openRouterParamPath = resolveAmplifySecretParamPathForTarget(targetEnv, 'OPENROUTER_API_KEY');
  if (openRouterParamPath && !process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      process.env.OPENROUTER_API_KEY = await fetchSecretFromParameterStore(openRouterParamPath, awsRegion);
    } catch {
      // This script does not call the categorizer; OPENROUTER is not required.
    }
  }

  return {
    targetEnv,
    urlSource,
    secretParamPath,
    supabase: createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  };
}

async function loadCandidateThreads(
  supabase: SupabaseClient,
  options: { limit: number | null; pageSize: number },
): Promise<{ totalMatchingThreads: number; threads: CandidateThreadRow[] }> {
  const countQuery = await supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('classification_status', 'complete')
    .eq('has_reply', true)
    .eq('handling_metadata->>mode', 'manual')
    .eq('handling_metadata->>category', 'Auto Reply');

  if (countQuery.error) {
    throw new Error(`Failed to count candidate threads: ${countQuery.error.message}`);
  }

  const totalMatchingThreads = countQuery.count ?? 0;
  const threads: CandidateThreadRow[] = [];
  let offset = 0;

  while (true) {
    const rangeLimit = options.limit ? Math.min(options.pageSize, options.limit - threads.length) : options.pageSize;
    if (rangeLimit <= 0) break;

    const { data, error } = await supabase
      .from('email_threads')
      .select('id, account_id, lead_id, conversation_status, classification_status, last_message_at, handling_metadata')
      .eq('classification_status', 'complete')
      .eq('has_reply', true)
      .eq('handling_metadata->>mode', 'manual')
      .eq('handling_metadata->>category', 'Auto Reply')
      .order('last_message_at', { ascending: false })
      .range(offset, offset + rangeLimit - 1);

    if (error) {
      throw new Error(`Failed to load candidate threads: ${error.message}`);
    }

    const rows = (data ?? []) as CandidateThreadRow[];
    if (rows.length === 0) break;

    threads.push(...rows);
    offset += rows.length;

    if (rows.length < rangeLimit) break;
    if (options.limit && threads.length >= options.limit) break;
  }

  return { totalMatchingThreads, threads };
}

async function loadLeadEmailById(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const leadIdChunk of chunk(leadIds, 200)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, email')
      .in('id', leadIdChunk);

    if (error) {
      throw new Error(`Failed to load leads for candidate threads: ${error.message}`);
    }

    for (const row of (data ?? []) as LeadRow[]) {
      map.set(row.id, row.email);
    }
  }
  return map;
}

async function loadLatestReceivedMessages(
  supabase: SupabaseClient,
  threadIds: string[],
): Promise<Map<string, ReceivedMessageRow>> {
  const latestByThread = new Map<string, ReceivedMessageRow>();

  for (const threadIdChunk of chunk(threadIds, 200)) {
    const { data, error } = await supabase
      .from('email_messages')
      .select('id, thread_id, from_email, from_name, subject, body_text, body_html, received_at, created_at')
      .eq('direction', 'received')
      .in('thread_id', threadIdChunk)
      .order('received_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to load received messages for candidate threads: ${error.message}`);
    }

    for (const row of (data ?? []) as ReceivedMessageRow[]) {
      const existing = latestByThread.get(row.thread_id);
      if (!existing) {
        latestByThread.set(row.thread_id, row);
        continue;
      }

      const existingAt = Date.parse(existing.received_at ?? existing.created_at);
      const rowAt = Date.parse(row.received_at ?? row.created_at);
      if (rowAt > existingAt) {
        latestByThread.set(row.thread_id, row);
      }
    }
  }

  return latestByThread;
}

async function buildAffectedThreads(
  supabase: SupabaseClient,
  options: { limit: number | null; pageSize: number },
): Promise<{ totalMatchingThreads: number; loadedThreads: number; affectedThreads: AffectedThread[] }> {
  const { totalMatchingThreads, threads } = await loadCandidateThreads(supabase, options);

  if (threads.length === 0) {
    return { totalMatchingThreads, loadedThreads: 0, affectedThreads: [] };
  }

  const [leadEmailById, latestReceivedByThread] = await Promise.all([
    loadLeadEmailById(
      supabase,
      threads.map((thread) => thread.lead_id).filter((value): value is string => !!value),
    ),
    loadLatestReceivedMessages(
      supabase,
      threads.map((thread) => thread.id),
    ),
  ]);

  const affectedThreads: AffectedThread[] = [];
  for (const thread of threads) {
    const latestReceived = latestReceivedByThread.get(thread.id);
    if (!latestReceived) continue;

    const leadEmail = thread.lead_id ? (leadEmailById.get(thread.lead_id) ?? null) : null;
    const bodyText = latestReceived.body_text ?? latestReceived.body_html ?? '';
    const redirect = detectAutoReplyRedirectSignals({
      fromEmail: latestReceived.from_email,
      leadEmail,
      bodyText,
    });

    if (!shouldIncludeThread(thread, redirect)) continue;

    affectedThreads.push({
      threadId: thread.id,
      accountId: thread.account_id,
      leadEmail,
      fromEmail: latestReceived.from_email,
      fromName: latestReceived.from_name,
      subject: latestReceived.subject,
      conversationStatus: thread.conversation_status,
      lastMessageAt: thread.last_message_at,
      bodyText,
      headerMismatch: redirect.headerMismatch,
    });
  }

  return { totalMatchingThreads, loadedThreads: threads.length, affectedThreads };
}

function buildReplacementMetadata(thread: AffectedThread) {
  const extraction = extractReferralContactHeuristic({
    bodyText: thread.bodyText,
    fromEmail: thread.fromEmail,
    fromName: thread.fromName,
    leadEmail: thread.leadEmail,
  });

  return {
    mode: 'manual',
    category: 'Auto Reply',
    return_date: null,
    primary_message: thread.headerMismatch
      ? 'This auto-reply came from a different contact. Consider replacing the lead.'
      : 'This auto-reply redirects you to a different contact.',
    primary: { action: 'replace_lead', label: 'Replace + forward with message' },
    alternatives: [{ action: 'mark_neutral', label: 'Mark neutral' }],
    follow_ups: [],
    suggested_reply: null,
    suggested_referral: buildSuggestedReferralFromExtraction(extraction, 'auto_reply_forward'),
    header_mismatch: thread.headerMismatch,
  };
}

async function applyUpdate(supabase: SupabaseClient, thread: AffectedThread): Promise<void> {
  const { error } = await supabase
    .from('email_threads')
    .update({
      handling_metadata: buildReplacementMetadata(thread),
      updated_at: new Date().toISOString(),
    })
    .eq('id', thread.threadId);

  if (error) {
    throw new Error(`Failed to update thread ${thread.threadId}: ${error.message}`);
  }
}

async function main() {
  const apply = process.env.APPLY === 'true';
  const limit = parsePositiveInteger(process.env.LIMIT);
  const pageSize = parsePositiveInteger(process.env.PAGE_SIZE) ?? 200;
  const batchSize = parsePositiveInteger(process.env.BATCH_SIZE) ?? 50;
  const { targetEnv, urlSource, secretParamPath, supabase } = await resolveSupabaseAdminClient();

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }

  const { totalMatchingThreads, loadedThreads, affectedThreads } = await buildAffectedThreads(supabase, {
    limit,
    pageSize,
  });

  console.log(`Total manual Auto Reply threads in scope: ${totalMatchingThreads}`);
  console.log(`Loaded threads for inspection: ${loadedThreads}`);
  console.log(`Affected threads needing replace-lead metadata: ${affectedThreads.length}`);
  console.log('Preview:');
  console.log(
    JSON.stringify(
      affectedThreads.slice(0, 20).map((thread) => {
        const extraction = extractReferralContactHeuristic({
          bodyText: thread.bodyText,
          fromEmail: thread.fromEmail,
          fromName: thread.fromName,
          leadEmail: thread.leadEmail,
        });
        return {
          thread_id: thread.threadId,
          account_id: thread.accountId,
          conversation_status: thread.conversationStatus,
          lead_email: thread.leadEmail,
          from_email: thread.fromEmail,
          from_name: thread.fromName,
          filled_fields: extraction.filledFields,
          confidence: extraction.confidence,
          first_name: extraction.fields.firstName ?? null,
          last_name: extraction.fields.lastName ?? null,
          header_mismatch: thread.headerMismatch,
          subject: previewText(thread.subject),
          last_message_at: thread.lastMessageAt,
        };
      }),
      null,
      2,
    ),
  );

  if (!apply || affectedThreads.length === 0) {
    console.log('Dry run only. Re-run with APPLY=true to update affected threads.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  for (const batch of chunk(affectedThreads, batchSize)) {
    console.log(`Processing batch of ${batch.length} thread(s)...`);
    for (const thread of batch) {
      try {
        await applyUpdate(supabase, thread);
        succeeded += 1;
        console.log(`Updated thread ${thread.threadId}.`);
      } catch (error) {
        failed += 1;
        console.error(error);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        totalMatchingThreads,
        loadedThreads,
        affectedThreads: affectedThreads.length,
        succeeded,
        failed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[reclassify-auto-reply-forward-threads] fatal error', error);
  process.exit(1);
});
