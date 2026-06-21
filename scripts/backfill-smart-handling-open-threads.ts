/**
 * Preview or backfill smart handling for historical open threads that never
 * entered the classify pipeline.
 *
 * Usage:
 *   npx tsx scripts/backfill-smart-handling-open-threads.ts
 *   LIMIT=100 npx tsx scripts/backfill-smart-handling-open-threads.ts
 *   ACCOUNT_ID=<uuid> LIMIT=25 APPLY=true npx tsx scripts/backfill-smart-handling-open-threads.ts
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=<uuid> BATCH_SIZE=10 APPLY=true npx tsx scripts/backfill-smart-handling-open-threads.ts
 */

import { createClient } from '@supabase/supabase-js';
import type { ClassifyReplyQueuePayload } from '../workers/inbox-checker-worker/src/emit-classify-reply-job.js';
import { loadCampaignCategorizerConfig } from '../workers/inbox-checker-worker/src/campaign-categorizer-config.js';
import { processClassifyReplyPayloadSafely } from '../amplify/functions/classifyReply/handler.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveAmplifySecretParamPathForTarget,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type CandidateThreadRow = {
  id: string;
  account_id: string;
  campaign_id: string | null;
  enrollment_id: string | null;
  conversation_status: string;
  classification_status: string;
  category: string | null;
  category_source: string | null;
  last_message_at: string | null;
};

type ReceivedMessageRow = {
  id: string;
  thread_id: string;
  from_email: string | null;
  subject: string | null;
  received_at: string | null;
  created_at: string;
};

type Candidate = {
  threadId: string;
  accountId: string;
  campaignId: string | null;
  enrollmentId: string | null;
  conversationStatus: string;
  classificationStatus: string;
  category: string | null;
  categorySource: string | null;
  lastMessageAt: string | null;
  latestReceivedMessageId: string;
  latestReceivedAt: string | null;
  latestReceivedFromEmail: string | null;
  latestReceivedSubject: string | null;
  hasCategorizer: boolean;
  useAi: boolean;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function chunk<T>(values: T[], size: number): T[][];
function chunk<T>(values: T[], size: number): Array<T[]> {
  const chunks: Array<T[]> = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function previewSubject(value: string | null): string | null {
  if (!value) return null;
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

async function resolveSupabaseAdminClient() {
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
      if (!key) {
        throw error;
      }
      console.warn(
        `[backfill-smart-handling-open-threads] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.',
    );
  }

  let openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
  const openRouterParamPath =
    process.env.OPENROUTER_API_KEY_PARAM_PATH?.trim() ||
    resolveAmplifySecretParamPathForTarget(targetEnv, 'OPENROUTER_API_KEY');
  if (openRouterParamPath && !openRouterApiKey) {
    try {
      openRouterApiKey = await fetchSecretFromParameterStore(openRouterParamPath, awsRegion);
      process.env.OPENROUTER_API_KEY = openRouterApiKey;
    } catch (error) {
      console.warn(
        `[backfill-smart-handling-open-threads] Failed to fetch ${openRouterParamPath}; non-auto-reply classifications may fail.`,
      );
    }
  }

  return {
    targetEnv,
    urlSource,
    secretParamPath,
    openRouterParamPath,
    hasOpenRouterApiKey: Boolean(openRouterApiKey),
    supabase: createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  };
}

async function loadLatestReceivedMessages(
  supabase: ReturnType<typeof createClient>,
  threadIds: string[],
): Promise<Map<string, ReceivedMessageRow>> {
  const latestByThread = new Map<string, ReceivedMessageRow>();

  for (const threadIdChunk of chunk(threadIds, 200)) {
    const { data, error } = await supabase
      .from('email_messages')
      .select('id, thread_id, from_email, subject, received_at, created_at')
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

async function buildCandidates(
  supabase: ReturnType<typeof createClient>,
  options: {
    accountId: string | null;
    campaignId: string | null;
    limit: number;
  },
): Promise<{ totalMatchingThreads: number; candidates: Candidate[] }> {
  let countQuery = supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_status', 'open')
    .eq('classification_status', 'none')
    .eq('has_reply', true);

  let threadsQuery = supabase
    .from('email_threads')
    .select(
      'id, account_id, campaign_id, enrollment_id, conversation_status, classification_status, category, category_source, last_message_at',
    )
    .eq('conversation_status', 'open')
    .eq('classification_status', 'none')
    .eq('has_reply', true)
    .order('last_message_at', { ascending: false })
    .limit(options.limit);

  if (options.accountId) {
    countQuery = countQuery.eq('account_id', options.accountId);
    threadsQuery = threadsQuery.eq('account_id', options.accountId);
  }

  if (options.campaignId) {
    countQuery = countQuery.eq('campaign_id', options.campaignId);
    threadsQuery = threadsQuery.eq('campaign_id', options.campaignId);
  }

  const [{ count, error: countError }, { data: threadsData, error: threadsError }] =
    await Promise.all([countQuery, threadsQuery]);

  if (countError) {
    throw new Error(`Failed to count candidate threads: ${countError.message}`);
  }
  if (threadsError) {
    throw new Error(`Failed to load candidate threads: ${threadsError.message}`);
  }

  const threads = (threadsData ?? []) as CandidateThreadRow[];
  if (threads.length === 0) {
    return { totalMatchingThreads: count ?? 0, candidates: [] };
  }

  const latestReceivedByThread = await loadLatestReceivedMessages(
    supabase,
    threads.map((thread) => thread.id),
  );

  const campaignConfigCache = new Map<string, { hasCategorizer: boolean; useAi: boolean }>();
  const candidates: Candidate[] = [];

  for (const thread of threads) {
    const latestReceived = latestReceivedByThread.get(thread.id);
    if (!latestReceived) {
      continue;
    }

    let hasCategorizer = false;
    let useAi = false;
    if (thread.campaign_id) {
      const cached = campaignConfigCache.get(thread.campaign_id);
      if (cached) {
        hasCategorizer = cached.hasCategorizer;
        useAi = cached.useAi;
      } else {
        const config = await loadCampaignCategorizerConfig(supabase, thread.campaign_id);
        campaignConfigCache.set(thread.campaign_id, config);
        hasCategorizer = config.hasCategorizer;
        useAi = config.useAi;
      }
    }

    candidates.push({
      threadId: thread.id,
      accountId: thread.account_id,
      campaignId: thread.campaign_id,
      enrollmentId: thread.enrollment_id,
      conversationStatus: thread.conversation_status,
      classificationStatus: thread.classification_status,
      category: thread.category,
      categorySource: thread.category_source,
      lastMessageAt: thread.last_message_at,
      latestReceivedMessageId: latestReceived.id,
      latestReceivedAt: latestReceived.received_at,
      latestReceivedFromEmail: latestReceived.from_email,
      latestReceivedSubject: latestReceived.subject,
      hasCategorizer,
      useAi,
    });
  }

  return { totalMatchingThreads: count ?? threads.length, candidates };
}

function buildQueuePayload(candidate: Candidate): ClassifyReplyQueuePayload {
  return {
    emailMessageId: candidate.latestReceivedMessageId,
    threadId: candidate.threadId,
    enrollmentId: candidate.enrollmentId,
    campaignId: candidate.campaignId,
    hasCategorizer: candidate.hasCategorizer,
    useAi: candidate.useAi,
  };
}

function logPreview(
  totalMatchingThreads: number,
  candidates: Candidate[],
  options: { apply: boolean; limit: number; batchSize: number; accountId: string | null; campaignId: string | null },
): void {
  console.log(`Total matching open threads in scope: ${totalMatchingThreads}`);
  console.log(`Loaded candidate threads (limit ${options.limit}): ${candidates.length}`);
  console.log(`Batch size: ${options.batchSize}`);
  if (options.accountId) {
    console.log(`Account scope: ${options.accountId}`);
  }
  if (options.campaignId) {
    console.log(`Campaign scope: ${options.campaignId}`);
  }

  const preview = candidates.slice(0, 20).map((candidate) => ({
    thread_id: candidate.threadId,
    account_id: candidate.accountId,
    campaign_id: candidate.campaignId,
    enrollment_id: candidate.enrollmentId,
    latest_received_message_id: candidate.latestReceivedMessageId,
    latest_received_at: candidate.latestReceivedAt,
    latest_received_from_email: candidate.latestReceivedFromEmail,
    latest_received_subject: previewSubject(candidate.latestReceivedSubject),
    category: candidate.category,
    category_source: candidate.categorySource,
    has_categorizer: candidate.hasCategorizer,
    use_ai: candidate.useAi,
  }));

  console.log('Preview:');
  console.log(JSON.stringify(preview, null, 2));

  if (!options.apply) {
    console.log('Dry run only. Re-run with APPLY=true to backfill smart handling for these threads.');
  }
}

async function markClassificationPending(
  supabase: ReturnType<typeof createClient>,
  threadId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('email_threads')
    .update({
      classification_status: 'pending',
      classification_requested_at: new Date().toISOString(),
      classification_completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('classification_status', 'none')
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark thread ${threadId} pending: ${error.message}`);
  }

  return Boolean(data?.id);
}

async function main() {
  const accountId = process.env.ACCOUNT_ID?.trim() || null;
  const campaignId = process.env.CAMPAIGN_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const limit = parsePositiveInteger(process.env.LIMIT, 250);
  const batchSize = parsePositiveInteger(process.env.BATCH_SIZE, 25);

  const { targetEnv, urlSource, secretParamPath, openRouterParamPath, hasOpenRouterApiKey, supabase } =
    await resolveSupabaseAdminClient();

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }
  if (hasOpenRouterApiKey) {
    console.log(
      openRouterParamPath
        ? `Resolved OPENROUTER_API_KEY from Parameter Store path ${openRouterParamPath}.`
        : 'Resolved OPENROUTER_API_KEY from environment variable.',
    );
  } else {
    console.warn('OPENROUTER_API_KEY is not set. Non-auto-reply classifications will fail.');
  }

  const { totalMatchingThreads, candidates } = await buildCandidates(supabase, {
    accountId,
    campaignId,
    limit,
  });

  logPreview(totalMatchingThreads, candidates, {
    apply,
    limit,
    batchSize,
    accountId,
    campaignId,
  });

  if (!apply || candidates.length === 0) {
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const batch of chunk(candidates, batchSize)) {
    console.log(`Processing batch of ${batch.length} thread(s)...`);

    for (const candidate of batch) {
      const claimed = await markClassificationPending(supabase, candidate.threadId);
      if (!claimed) {
        skipped += 1;
        console.log(`Skipped thread ${candidate.threadId}; classification state changed before processing.`);
        continue;
      }

      processed += 1;
      const payload = buildQueuePayload(candidate);
      const result = await processClassifyReplyPayloadSafely(payload, supabase);

      if (result.ok) {
        succeeded += 1;
        console.log(
          `Backfilled smart handling for thread ${candidate.threadId} using message ${candidate.latestReceivedMessageId}.`,
        );
      } else {
        failed += 1;
        console.error(
          `Failed to backfill smart handling for thread ${candidate.threadId}:`,
          result.error,
        );
      }
    }
  }

  console.log('Backfill complete.');
  console.log(
    JSON.stringify(
      {
        totalMatchingThreads,
        loadedCandidates: candidates.length,
        processed,
        succeeded,
        failed,
        skipped,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[backfill-smart-handling-open-threads] fatal error', error);
  process.exit(1);
});
