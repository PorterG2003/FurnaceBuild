import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildSkipSherpaLookupPayload,
  callSkipSherpaPersonLookup,
  classifySkipSherpaPersonResult,
  listContactEnrichmentTargetsPage,
  MAX_CONTACT_ENRICHMENT_BATCH_SIZE,
  persistContactEnrichmentAttempt,
  type ContactEnrichmentTargetRow,
} from '@furnace/registry-server';

let cachedClient: SupabaseClient | null = null;

function getLeadsClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.LEADS_SUPABASE_URL;
  const key = process.env.LEADS_SUPABASE_SECRET_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

type ChunkEvent = {
  action?: 'chunk';
  jobId: string;
  batchSize: number;
  cursor: string | null;
};

type FinalizeEvent = { action: 'finalize'; jobId: string };
type FailEvent = { action: 'fail'; jobId: string; message?: string };

type ContactEnrichmentProgress = Record<string, unknown> & {
  total_targets?: number;
  targets_processed?: number;
  outcome_accepted?: number;
  outcome_accepted_by_ruleset?: number;
  outcome_ambiguous?: number;
  outcome_ambiguous_reviewable?: number;
  outcome_ambiguous_low_signal?: number;
  outcome_no_match?: number;
  outcome_error?: number;
  outcome_skipped_recent?: number;
};

function increment(progress: ContactEnrichmentProgress, key: keyof ContactEnrichmentProgress, amount = 1): number {
  return Number(progress[key] ?? 0) + amount;
}

function applyClassification(
  progress: ContactEnrichmentProgress,
  decision: {
    classification: 'accepted_strong_match' | 'ambiguous' | 'no_match' | 'error';
    metadata?: { ambiguity_kind?: 'reviewable' | 'low_signal' | null };
  },
): ContactEnrichmentProgress {
  const next = { ...progress };
  next.targets_processed = increment(next, 'targets_processed');
  switch (decision.classification) {
    case 'accepted_strong_match':
      next.outcome_accepted = increment(next, 'outcome_accepted');
      next.outcome_accepted_by_ruleset = increment(next, 'outcome_accepted_by_ruleset');
      break;
    case 'ambiguous':
      next.outcome_ambiguous = increment(next, 'outcome_ambiguous');
      if (decision.metadata?.ambiguity_kind === 'low_signal') {
        next.outcome_ambiguous_low_signal = increment(next, 'outcome_ambiguous_low_signal');
      } else {
        next.outcome_ambiguous_reviewable = increment(next, 'outcome_ambiguous_reviewable');
      }
      break;
    case 'no_match':
      next.outcome_no_match = increment(next, 'outcome_no_match');
      break;
    case 'error':
    default:
      next.outcome_error = increment(next, 'outcome_error');
      break;
  }
  return next;
}

export const handler = async (event: ChunkEvent | FinalizeEvent | FailEvent): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as ContactEnrichmentProgress;
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: { ...prev, current_step: 'done' },
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  if ('action' in event && event.action === 'fail') {
    const client = getLeadsClient();
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: event.message ?? 'Step Functions failure',
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  const apiKey = process.env.SKIPSHERPA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing SKIPSHERPA_API_KEY');
  }

  const e = event as ChunkEvent;
  const client = getLeadsClient();
  const batchSize = Math.min(MAX_CONTACT_ENRICHMENT_BATCH_SIZE, Math.max(1, Number(e.batchSize) || 10));
  const page = await listContactEnrichmentTargetsPage(client, e.jobId, batchSize, e.cursor ?? null);

  const { data: job } = await client.from('foundry_jobs').select('progress, payload').eq('id', e.jobId).maybeSingle();
  let progress = (job?.progress ?? {}) as ContactEnrichmentProgress;
  const payload = (job?.payload ?? {}) as Record<string, unknown>;
  const rulesetPreset =
    typeof payload.ruleset_preset === 'string'
      ? payload.ruleset_preset
      : typeof payload.rulesetPreset === 'string'
        ? payload.rulesetPreset
        : undefined;
  const queueAmbiguousForReview =
    payload.queue_ambiguous_for_review === true || payload.queueAmbiguousForReview === true;
  if (progress.total_targets == null) {
    const { count, error: countErr } = await client
      .from('contact_enrichment_targets')
      .select('id', { count: 'exact', head: true })
      .eq('foundry_job_id', e.jobId);
    if (countErr) throw new Error(countErr.message);
    progress.total_targets = count ?? 0;
  }

  if (page.targets.length === 0) {
    await client
      .from('foundry_jobs')
      .update({
        status: 'running',
        progress: {
          ...progress,
          processed: Number(progress.targets_processed ?? 0),
          current_step: 'contact_enrichment_chunk',
          cursor: null,
        },
      })
      .eq('id', e.jobId);
    return { done: true, nextCursor: null, scanned: 0 };
  }

  const lookupPayloads = page.targets.map((target: ContactEnrichmentTargetRow) =>
    buildSkipSherpaLookupPayload(target),
  );
  const providerResponse = await callSkipSherpaPersonLookup(apiKey, lookupPayloads);
  const results =
    providerResponse.body &&
    typeof providerResponse.body === 'object' &&
    Array.isArray((providerResponse.body as { person_results?: unknown[] }).person_results)
      ? ((providerResponse.body as { person_results: unknown[] }).person_results as unknown[])
      : [];

  for (const [index, target] of page.targets.entries()) {
    const rawResult = results[index];
    const result =
      rawResult && typeof rawResult === 'object'
        ? (rawResult as Parameters<typeof classifySkipSherpaPersonResult>[1])
        : ({
            status_code: providerResponse.httpStatus >= 200 && providerResponse.httpStatus < 300 ? 500 : providerResponse.httpStatus,
            expected_results: 0,
            issues:
              providerResponse.body && typeof providerResponse.body === 'object'
                ? ((providerResponse.body as { issues?: Record<string, unknown>[] }).issues ?? [])
                : [],
            persons: [],
          } as Parameters<typeof classifySkipSherpaPersonResult>[1]);
    const decision = classifySkipSherpaPersonResult(target, result, {
      rulesetPreset: rulesetPreset as 'conservative' | 'balanced' | 'aggressive' | undefined,
      queueAmbiguousForReview,
    });
    await persistContactEnrichmentAttempt(client, {
      jobId: e.jobId,
      target,
      requestPayload: lookupPayloads[index]!,
      responsePayload: rawResult ?? providerResponse.body,
      httpStatus: providerResponse.httpStatus,
      decision,
    });
    progress = applyClassification(progress, decision);
  }

  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...progress,
        processed: Number(progress.targets_processed ?? 0),
        current_step: 'contact_enrichment_chunk',
        cursor: page.nextCursor,
      },
    })
    .eq('id', e.jobId);

  return {
    done: page.done,
    nextCursor: page.nextCursor,
    scanned: page.targets.length,
  };
};
