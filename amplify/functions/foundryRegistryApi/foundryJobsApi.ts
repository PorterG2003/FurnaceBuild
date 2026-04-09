import { createHash } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildContactEnrichmentPreflight,
  bucketCompaniesForMatching,
  CONTACT_ENRICHMENT_VERSION,
  getReconciliationOutcomeCounts,
  insertContactEnrichmentTargetsForJob,
  LINKER_VERSION,
  MATCHER_VERSION,
  NORMALIZER_VERSION,
  resolveContactEnrichmentOptions,
  resolveRunCost,
  stateMatchingJobVersions,
  stateMatchingPreflight,
} from '@furnace/registry-server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FunctionUrlResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

function jsonResponse(statusCode: number, data: object): FunctionUrlResponse {
  return {
    statusCode,
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  };
}

function parseJsonBody<T>(raw: string): { ok: true; value: T } | { ok: false; response: FunctionUrlResponse } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'Invalid JSON body' }) };
  }
}

function parseLimit(q: string, max: number, def: number): number {
  const params = new URLSearchParams(q || '');
  const raw = params.get('limit');
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

const sfnClient = new SFNClient({});

/** Outcome for UI `pipeline.normalize` and for mapping to HTTP when starting normalize from the API route. */
export type NormalizeJobStartOutcome =
  | { status: 'started'; jobId: string; executionArn: string; reused: boolean }
  | {
      status: 'failed';
      error: string;
      detail?: string;
      /** Same semantics as HTTP: 503 = async stack not configured */
      code?: 'not_configured' | 'not_found' | 'server_error';
    };

export type AutolinkJobStartOutcome = NormalizeJobStartOutcome;
export type ContactEnrichmentJobStartOutcome =
  | { status: 'started'; jobId: string; executionArn: string; reused: boolean; preflight: unknown }
  | {
      status: 'failed';
      error: string;
      detail?: string;
      code?: 'not_configured' | 'not_found' | 'not_eligible' | 'server_error';
      preflight?: unknown;
    };

async function countSourceRowsForRun(leadsClient: SupabaseClient, runId: string): Promise<number> {
  const { count, error } = await leadsClient
    .from('source_business_records')
    .select('id', { count: 'exact', head: true })
    .eq('ingestion_run_id', runId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function buildCompanyBatches(companyIds: string[], batchSize: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < companyIds.length; i += batchSize) {
    out.push(companyIds.slice(i, i + batchSize));
  }
  return out;
}

async function collectLinkedCompanyIdsForIngestionRun(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<string[]> {
  const companyIds = new Set<string>();
  const pageSize = 1000;
  const linkLookupBatchSize = 200;
  let offset = 0;

  for (;;) {
    const { data: records, error: recordErr } = await leadsClient
      .from('source_business_records')
      .select('id')
      .eq('ingestion_run_id', runId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (recordErr) throw new Error(recordErr.message);
    const ids = (records ?? []).map((row) => row.id as string);
    if (ids.length === 0) break;

    // PostgREST chokes on very large `in (...)` filters, so resolve links in chunks.
    for (const recordIdBatch of buildCompanyBatches(ids, linkLookupBatchSize)) {
      const { data: links, error: linkErr } = await leadsClient
        .from('source_business_company_links')
        .select('company_id')
        .eq('is_current', true)
        .eq('link_status', 'linked')
        .in('source_business_record_id', recordIdBatch);
      if (linkErr) throw new Error(linkErr.message);
      for (const link of links ?? []) {
        const companyId = typeof link.company_id === 'string' ? link.company_id : '';
        if (companyId) companyIds.add(companyId);
      }
    }

    if (ids.length < pageSize) break;
    offset += pageSize;
  }

  return [...companyIds];
}

/**
 * Shared by POST /ingestion-runs/:id/jobs/normalize and post-import pipeline.
 * Does not throw; returns structured outcome for JSON embedding.
 */
export async function startNormalizeIngestionJob(
  leadsClient: SupabaseClient,
  runId: string,
  userId: string,
  opts?: { batchSize?: number },
): Promise<NormalizeJobStartOutcome> {
  const smArn = process.env.FOUNDRY_NORMALIZE_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return {
      status: 'failed',
      error: 'Async normalize is not configured (check Amplify backend / deploy)',
      code: 'not_configured',
    };
  }

  const batchSize = Math.min(2000, Math.max(1, Number(opts?.batchSize) || 500));

  const { data: runRow, error: runErr } = await leadsClient
    .from('ingestion_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle();
  if (runErr) {
    console.error('ingestion_runs lookup failed', runErr.message);
    return {
      status: 'failed',
      error: 'Failed to verify ingestion run',
      detail: runErr.message,
      code: 'server_error',
    };
  }
  if (!runRow) {
    return {
      status: 'failed',
      error: 'Ingestion run not found',
      code: 'not_found',
    };
  }

  const idempotencyKey = `normalize:${runId}:${NORMALIZER_VERSION}`;

  const { data: active, error: activeErr } = await leadsClient
    .from('foundry_jobs')
    .select('id, status, step_function_execution_arn')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'running'])
    .maybeSingle();

  if (activeErr) {
    console.error('foundry_jobs idempotency lookup failed', activeErr.message);
    return {
      status: 'failed',
      error: 'Failed to check existing job',
      detail: activeErr.message,
      code: 'server_error',
    };
  }

  if (active) {
    return {
      status: 'started',
      jobId: active.id as string,
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
    };
  }

  const { data: inserted, error: insErr } = await leadsClient
    .from('foundry_jobs')
    .insert({
      job_type: 'normalize_ingestion_run',
      status: 'queued',
      requested_by: userId,
      payload: { ingestion_run_id: runId, batch_size: batchSize },
      idempotency_key: idempotencyKey,
      progress: { current_step: 'queued' },
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '23505') {
      const { data: again } = await leadsClient
        .from('foundry_jobs')
        .select('id, step_function_execution_arn')
        .eq('idempotency_key', idempotencyKey)
        .in('status', ['queued', 'running'])
        .maybeSingle();
      if (again) {
        return {
          status: 'started',
          jobId: again.id as string,
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
        };
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return {
      status: 'failed',
      error: 'Failed to create job',
      detail: insErr?.message,
      code: 'server_error',
    };
  }

  const jobId = inserted.id as string;

  try {
    const execName = `norm-${jobId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`;
    const out = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: smArn,
        name: execName.slice(0, 80),
        input: JSON.stringify({
          jobId,
          ingestionRunId: runId,
          batchSize,
          cursor: null,
        }),
      }),
    );

    const executionArn = out.executionArn ?? '';
    const { error: updErr } = await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'running',
        step_function_execution_arn: executionArn,
        started_at: new Date().toISOString(),
        progress: { current_step: 'running' },
      })
      .eq('id', jobId);

    if (updErr) {
      console.error('foundry_jobs update after start failed', updErr.message);
    }

    return { status: 'started', jobId, executionArn, reused: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('StartExecution failed', msg);
    await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', jobId);
    return {
      status: 'failed',
      error: 'Failed to start workflow',
      detail: msg,
      code: 'server_error',
    };
  }
}

export async function startAutolinkIngestionJob(
  leadsClient: SupabaseClient,
  runId: string,
  userId: string,
  opts?: { batchSize?: number },
): Promise<AutolinkJobStartOutcome> {
  const smArn = process.env.FOUNDRY_AUTOLINK_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return {
      status: 'failed',
      error: 'Async autolink is not configured (check Amplify backend / deploy)',
      code: 'not_configured',
    };
  }

  const batchSize = Math.min(500, Math.max(1, Number(opts?.batchSize) || 100));

  const { data: runRow, error: runErr } = await leadsClient
    .from('ingestion_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle();
  if (runErr) {
    console.error('ingestion_runs lookup failed', runErr.message);
    return {
      status: 'failed',
      error: 'Failed to verify ingestion run',
      detail: runErr.message,
      code: 'server_error',
    };
  }
  if (!runRow) {
    return {
      status: 'failed',
      error: 'Ingestion run not found',
      code: 'not_found',
    };
  }

  const idempotencyKey = `autolink:${runId}:${LINKER_VERSION}`;
  const { data: active, error: activeErr } = await leadsClient
    .from('foundry_jobs')
    .select('id, step_function_execution_arn')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (activeErr) {
    console.error('foundry_jobs idempotency lookup failed', activeErr.message);
    return {
      status: 'failed',
      error: 'Failed to check existing job',
      detail: activeErr.message,
      code: 'server_error',
    };
  }
  if (active) {
    return {
      status: 'started',
      jobId: active.id as string,
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
    };
  }

  let totalRows = 0;
  try {
    totalRows = await countSourceRowsForRun(leadsClient, runId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: 'failed',
      error: 'Failed to count source rows',
      detail: message,
      code: 'server_error',
    };
  }

  const { data: inserted, error: insErr } = await leadsClient
    .from('foundry_jobs')
    .insert({
      job_type: 'autolink_ingestion_run',
      status: 'queued',
      requested_by: userId,
      payload: { ingestion_run_id: runId, batch_size: batchSize },
      idempotency_key: idempotencyKey,
      progress: {
        current_step: 'queued',
        total_rows: totalRows,
        rows_processed: 0,
        outcome_linked: 0,
        outcome_needs_review: 0,
        outcome_failed: 0,
        outcome_skipped: 0,
      },
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === '23505') {
      const { data: again } = await leadsClient
        .from('foundry_jobs')
        .select('id, step_function_execution_arn')
        .eq('idempotency_key', idempotencyKey)
        .in('status', ['queued', 'running'])
        .maybeSingle();
      if (again) {
        return {
          status: 'started',
          jobId: again.id as string,
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
        };
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return {
      status: 'failed',
      error: 'Failed to create job',
      detail: insErr?.message,
      code: 'server_error',
    };
  }

  const jobId = inserted.id as string;
  try {
    const execName = `alink-${jobId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`;
    const out = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: smArn,
        name: execName.slice(0, 80),
        input: JSON.stringify({
          jobId,
          ingestionRunId: runId,
          batchSize,
          cursor: null,
        }),
      }),
    );

    const executionArn = out.executionArn ?? '';
    const { error: updErr } = await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'running',
        step_function_execution_arn: executionArn,
        started_at: new Date().toISOString(),
        progress: {
          current_step: 'running',
          total_rows: totalRows,
          rows_processed: 0,
          outcome_linked: 0,
          outcome_needs_review: 0,
          outcome_failed: 0,
          outcome_skipped: 0,
        },
      })
      .eq('id', jobId);
    if (updErr) {
      console.error('foundry_jobs update after autolink start failed', updErr.message);
    }
    return { status: 'started', jobId, executionArn, reused: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Autolink StartExecution failed', msg);
    await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', jobId);
    return {
      status: 'failed',
      error: 'Failed to start workflow',
      detail: msg,
      code: 'server_error',
    };
  }
}

export async function startContactEnrichmentIngestionJob(
  leadsClient: SupabaseClient,
  runId: string,
  userId: string,
  opts?: {
    freshnessWindowDays?: number;
    forceRerunRecent?: boolean;
    strongTargetsOnly?: boolean;
    batchSize?: number;
    rulesetPreset?: 'conservative' | 'balanced' | 'aggressive';
    queueAmbiguousForReview?: boolean;
    /** Override cents per lookup; otherwise uses active rate card for skipsherpa/person_lookup. */
    costPerLookupCents?: number | null;
  },
): Promise<ContactEnrichmentJobStartOutcome> {
  const smArn = process.env.FOUNDRY_CONTACT_ENRICHMENT_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return {
      status: 'failed',
      error: 'Async contact enrichment is not configured (check Amplify backend / deploy)',
      code: 'not_configured',
    };
  }

  const batchSize = Math.min(25, Math.max(1, Number(opts?.batchSize) || 10));
  const resolved = resolveContactEnrichmentOptions({
    freshnessWindowDays: opts?.freshnessWindowDays,
    forceRerunRecent: opts?.forceRerunRecent,
    strongTargetsOnly: opts?.strongTargetsOnly,
    rulesetPreset: opts?.rulesetPreset,
    queueAmbiguousForReview: opts?.queueAmbiguousForReview,
  });

  const { data: runRow, error: runErr } = await leadsClient
    .from('ingestion_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle();
  if (runErr) {
    console.error('ingestion_runs lookup failed', runErr.message);
    return {
      status: 'failed',
      error: 'Failed to verify ingestion run',
      detail: runErr.message,
      code: 'server_error',
    };
  }
  if (!runRow) {
    return {
      status: 'failed',
      error: 'Ingestion run not found',
      code: 'not_found',
    };
  }

  let preflight;
  try {
    preflight = await buildContactEnrichmentPreflight(leadsClient, runId, resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      error: 'Failed to build contact enrichment preflight',
      detail: message,
      code: 'server_error',
    };
  }
  const preflightResponse = {
    ingestion_run_id: preflight.ingestion_run_id,
    source_name: preflight.source_name,
    active_job_id: null,
    options: {
      freshness_window_days: preflight.options.freshnessWindowDays,
      force_rerun_recent: preflight.options.forceRerunRecent,
      strong_targets_only: preflight.options.strongTargetsOnly,
      ruleset_preset: preflight.options.rulesetPreset,
      queue_ambiguous_for_review: preflight.options.queueAmbiguousForReview,
    },
    counts: preflight.counts,
  };
  if (preflight.counts.eligible === 0) {
    return {
      status: 'failed',
      error: 'No eligible contact enrichment targets for this import',
      code: 'not_eligible',
      preflight: preflightResponse,
    };
  }

  const costResolved = await resolveRunCost(
    leadsClient,
    'enrichment',
    'skipsherpa',
    'person_lookup',
    opts?.costPerLookupCents ?? undefined,
  );

  const idempotencyKey = [
    'contact-enrich',
    runId,
    CONTACT_ENRICHMENT_VERSION,
    `days:${resolved.freshnessWindowDays}`,
    `force:${resolved.forceRerunRecent ? 1 : 0}`,
    `strong:${resolved.strongTargetsOnly ? 1 : 0}`,
    `ruleset:${resolved.rulesetPreset}`,
    `qamb:${resolved.queueAmbiguousForReview ? 1 : 0}`,
    `cost:${costResolved?.unitPriceCents ?? 'na'}:ov:${costResolved?.isOverride ? 1 : 0}`,
  ].join(':');

  const { data: active, error: activeErr } = await leadsClient
    .from('foundry_jobs')
    .select('id, step_function_execution_arn, payload')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (activeErr) {
    console.error('foundry_jobs idempotency lookup failed', activeErr.message);
    return {
      status: 'failed',
      error: 'Failed to check existing job',
      detail: activeErr.message,
      code: 'server_error',
    };
  }
  if (active) {
    return {
      status: 'started',
      jobId: active.id as string,
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
      preflight: (active.payload as Record<string, unknown>)?.preflight ?? preflightResponse,
    };
  }

  const payload = {
    ingestion_run_id: runId,
    batch_size: batchSize,
    source_name: preflight.source_name,
    freshness_window_days: resolved.freshnessWindowDays,
    force_rerun_recent: resolved.forceRerunRecent,
    strong_targets_only: resolved.strongTargetsOnly,
    ruleset_preset: resolved.rulesetPreset,
    queue_ambiguous_for_review: resolved.queueAmbiguousForReview,
    contact_enrichment_version: CONTACT_ENRICHMENT_VERSION,
    preflight: preflightResponse,
    ...(costResolved != null
      ? {
          cost_per_lookup_cents: costResolved.unitPriceCents,
          cost_rate_card_id: costResolved.rateCardId,
          cost_is_override: costResolved.isOverride,
        }
      : {}),
  };

  const { data: inserted, error: insErr } = await leadsClient
    .from('foundry_jobs')
    .insert({
      job_type: 'contact_enrichment_import_run',
      status: 'queued',
      requested_by: userId,
      payload,
      idempotency_key: idempotencyKey,
      progress: {
        current_step: 'queued',
        total_targets: preflight.counts.eligible,
        targets_processed: 0,
        outcome_accepted: 0,
        outcome_accepted_by_ruleset: 0,
        outcome_ambiguous: 0,
        outcome_ambiguous_reviewable: 0,
        outcome_ambiguous_low_signal: 0,
        outcome_no_match: 0,
        outcome_error: 0,
        outcome_skipped_recent: preflight.counts.skipped_recent_lookup,
      },
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === '23505') {
      const { data: again } = await leadsClient
        .from('foundry_jobs')
        .select('id, step_function_execution_arn, payload')
        .eq('idempotency_key', idempotencyKey)
        .in('status', ['queued', 'running'])
        .maybeSingle();
      if (again) {
        return {
          status: 'started',
          jobId: again.id as string,
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
          preflight: (again.payload as Record<string, unknown>)?.preflight ?? preflightResponse,
        };
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return {
      status: 'failed',
      error: 'Failed to create job',
      detail: insErr?.message,
      code: 'server_error',
    };
  }

  const jobId = inserted.id as string;
  try {
    await insertContactEnrichmentTargetsForJob(leadsClient, jobId, preflight);
    const execName = `cenr-${jobId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`;
    const out = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: smArn,
        name: execName.slice(0, 80),
        input: JSON.stringify({
          jobId,
          batchSize,
          cursor: null,
        }),
      }),
    );

    const executionArn = out.executionArn ?? '';
    const { error: updErr } = await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'running',
        step_function_execution_arn: executionArn,
        started_at: new Date().toISOString(),
        progress: {
          current_step: 'running',
          total_targets: preflight.counts.eligible,
          targets_processed: 0,
          outcome_accepted: 0,
          outcome_accepted_by_ruleset: 0,
          outcome_ambiguous: 0,
          outcome_ambiguous_reviewable: 0,
          outcome_ambiguous_low_signal: 0,
          outcome_no_match: 0,
          outcome_error: 0,
          outcome_skipped_recent: preflight.counts.skipped_recent_lookup,
        },
      })
      .eq('id', jobId);
    if (updErr) {
      console.error('foundry_jobs update after contact enrichment start failed', updErr.message);
    }
    return { status: 'started', jobId, executionArn, reused: false, preflight: payload.preflight };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Contact enrichment StartExecution failed', msg);
    await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', jobId);
    return {
      status: 'failed',
      error: 'Failed to start workflow',
      detail: msg,
      code: 'server_error',
      preflight: payload.preflight,
    };
  }
}

export async function handleFoundryJobsRequest(
  leadsClient: SupabaseClient,
  method: string,
  path: string,
  rawBody: string,
  rawQueryString: string,
  userId: string,
): Promise<FunctionUrlResponse | null> {
  if (path === '/jobs' && method === 'GET') {
    return handleListJobs(leadsClient, rawQueryString);
  }

  const jobGet = path.match(/^\/jobs\/([^/]+)$/);
  if (jobGet && method === 'GET') {
    const id = jobGet[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid job id' });
    return handleGetJob(leadsClient, id);
  }

  const normJob = path.match(/^\/ingestion-runs\/([^/]+)\/jobs\/normalize$/);
  if (normJob && method === 'POST') {
    const runId = normJob[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    return handlePostNormalizeJob(leadsClient, runId, rawBody, userId);
  }

  const autolinkJob = path.match(/^\/ingestion-runs\/([^/]+)\/jobs\/autolink$/);
  if (autolinkJob && method === 'POST') {
    const runId = autolinkJob[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    return handlePostAutolinkJob(leadsClient, runId, rawBody, userId);
  }

  const contactEnrichmentJob = path.match(/^\/ingestion-runs\/([^/]+)\/jobs\/contact-enrichment$/);
  if (contactEnrichmentJob && method === 'POST') {
    const runId = contactEnrichmentJob[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    return handlePostContactEnrichmentJob(leadsClient, runId, rawBody, userId);
  }

  const pipelineJobs = path.match(/^\/ingestion-runs\/([^/]+)\/pipeline-jobs$/);
  if (pipelineJobs && method === 'GET') {
    const runId = pipelineJobs[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    return handleGetPipelineJobs(leadsClient, runId);
  }

  const importStateMatching = path.match(/^\/ingestion-runs\/([^/]+)\/state-matching$/);
  if (importStateMatching && method === 'POST') {
    const runId = importStateMatching[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    return handlePostImportScopedStateMatching(leadsClient, runId, userId);
  }

  if (path === '/state-matching/batches' && method === 'POST') {
    const parsed = parseJsonBody<{ companyIds?: string[]; sourceIngestionRunId?: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const ids = parsed.value.companyIds ?? [];
    if (ids.length > 50) return jsonResponse(400, { error: 'At most 50 companies per batch' });
    let sourceIngestionRunId: string | undefined;
    const rawIngest = parsed.value.sourceIngestionRunId?.trim();
    if (rawIngest) {
      if (!UUID_RE.test(rawIngest)) return jsonResponse(400, { error: 'Invalid sourceIngestionRunId' });
      sourceIngestionRunId = rawIngest;
    }
    return startStateMatchingBatchJob(leadsClient, ids, userId, { sourceIngestionRunId });
  }

  return null;
}

/** Async state matching: reconciliation_runs + foundry_jobs + Step Functions (Utah + Florida ECS). */
export async function startStateMatchingBatchJob(
  leadsClient: SupabaseClient,
  companyIds: string[],
  userId: string,
  opts?: { sourceIngestionRunId?: string; importScoped?: boolean },
): Promise<FunctionUrlResponse> {
  const smArn = process.env.FOUNDRY_STATE_MATCHING_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return jsonResponse(503, { error: 'Async state matching is not configured (Amplify backend / Step Functions)' });
  }

  // Shared helpers bulk-load company state + promoted matches so large import-scoped starts don't time out.
  const pre = await stateMatchingPreflight(
    leadsClient as unknown as Parameters<typeof stateMatchingPreflight>[0],
    { companyIds },
  );
  const { utahCompanyIds, floridaCompanyIds, unsupported } = await bucketCompaniesForMatching(
    leadsClient as unknown as Parameters<typeof bucketCompaniesForMatching>[0],
    pre.ready,
  );
  if (unsupported.length > 0) {
    return jsonResponse(400, {
      error:
        'Automated state registry matching supports Utah (UT) and Florida (FL) only. Remove non-UT/FL companies or fix locations.',
      unsupported,
    });
  }
  const versions = stateMatchingJobVersions();
  const uniqueCompanyIds = [...new Set(companyIds)];
  const inScopeTotal = new Set([...utahCompanyIds, ...floridaCompanyIds]).size;
  const notApplicableCount = Math.max(0, uniqueCompanyIds.length - inScopeTotal);
  const sortedKey = [...uniqueCompanyIds].sort().join(',');
  const idempotencyKey =
    opts?.importScoped && opts.sourceIngestionRunId
      ? `state-match-ingestion:${opts.sourceIngestionRunId}:${MATCHER_VERSION}`
      : `state-match:${createHash('sha256').update(sortedKey).digest('hex').slice(0, 32)}:${MATCHER_VERSION}`;

  const { data: active, error: activeErr } = await leadsClient
    .from('foundry_jobs')
    .select('id, status, step_function_execution_arn, payload')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'running'])
    .maybeSingle();

  if (activeErr) {
    console.error('foundry_jobs idempotency lookup failed', activeErr.message);
    return jsonResponse(502, { error: 'Failed to check existing job' });
  }

  if (active) {
    const pl = active.payload as {
      reconciliation_run_id?: string;
      preflight?: unknown;
      utah_company_ids?: string[];
      florida_company_ids?: string[];
    };
    return jsonResponse(200, {
      jobId: active.id,
      reconciliation_run_id: String(pl.reconciliation_run_id ?? ''),
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
      preflight: pl.preflight ?? pre,
      bucket_counts: {
        utah: pl.utah_company_ids?.length ?? 0,
        florida: pl.florida_company_ids?.length ?? 0,
      },
    });
  }

  const { data: runRow, error: runErr } = await leadsClient
    .from('reconciliation_runs')
    .insert({
      status: 'running',
      matcher_version: versions.matcher_version,
      scoring_version: versions.scoring_version,
      ruleset_version: versions.ruleset_version,
      meta: {
        run_kind: 'state_matching_orchestration',
        preflight: pre,
        utah_company_ids: utahCompanyIds,
        florida_company_ids: floridaCompanyIds,
        async: true,
      },
    })
    .select('id')
    .single();
  if (runErr || !runRow) {
    console.error('reconciliation_runs insert failed', runErr?.message);
    return jsonResponse(502, { error: 'Failed to create reconciliation run' });
  }
  const reconciliationRunId = runRow.id as string;

  const { data: inserted, error: insErr } = await leadsClient
    .from('foundry_jobs')
    .insert({
      job_type: 'state_matching_batch',
      status: 'queued',
      requested_by: userId,
      payload: {
        reconciliation_run_id: reconciliationRunId,
        company_ids: uniqueCompanyIds,
        preflight: pre,
        utah_company_ids: utahCompanyIds,
        utah_batches: buildCompanyBatches(utahCompanyIds, 25),
        florida_company_ids: floridaCompanyIds,
        florida_batches: buildCompanyBatches(floridaCompanyIds, 25),
        ...(opts?.sourceIngestionRunId
          ? { source_ingestion_run_id: opts.sourceIngestionRunId }
          : {}),
      },
      idempotency_key: idempotencyKey,
      progress: {
        current_step: 'queued',
        utah_count: utahCompanyIds.length,
        florida_count: floridaCompanyIds.length,
        in_scope_total: inScopeTotal,
        not_applicable_count: notApplicableCount,
        companies_with_result: 0,
      },
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '23505') {
      const { data: again } = await leadsClient
        .from('foundry_jobs')
        .select('id, step_function_execution_arn, payload')
        .eq('idempotency_key', idempotencyKey)
        .in('status', ['queued', 'running'])
        .maybeSingle();
      if (again) {
        const pl = again.payload as {
          reconciliation_run_id?: string;
          preflight?: unknown;
          utah_company_ids?: string[];
          florida_company_ids?: string[];
        };
        await leadsClient.from('reconciliation_runs').delete().eq('id', reconciliationRunId);
        return jsonResponse(200, {
          jobId: again.id,
          reconciliation_run_id: String(pl.reconciliation_run_id ?? ''),
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
          preflight: pl.preflight ?? pre,
          bucket_counts: {
            utah: pl.utah_company_ids?.length ?? 0,
            florida: pl.florida_company_ids?.length ?? 0,
          },
        });
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return jsonResponse(502, { error: 'Failed to create job' });
  }

  const jobId = inserted.id as string;

  const utahCount = utahCompanyIds.length;
  const floridaCount = floridaCompanyIds.length;
  const utahBatches = buildCompanyBatches(utahCompanyIds, 25);
  const floridaBatches = buildCompanyBatches(floridaCompanyIds, 25);
  const sfnInput = {
    jobId,
    reconciliationRunId,
    utahCount,
    floridaCount,
    utahBatches,
    floridaBatches,
  };

  try {
    const execName = `stm-${jobId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`;
    const out = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: smArn,
        name: execName.slice(0, 80),
        input: JSON.stringify(sfnInput),
      }),
    );

    const executionArn = out.executionArn ?? '';
    const { error: updErr } = await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'running',
        step_function_execution_arn: executionArn,
        started_at: new Date().toISOString(),
        progress: {
          current_step: 'running',
          utah_count: utahCount,
          florida_count: floridaCount,
          in_scope_total: inScopeTotal,
          not_applicable_count: notApplicableCount,
          companies_with_result: 0,
        },
      })
      .eq('id', jobId);

    if (updErr) {
      console.error('foundry_jobs update after start failed', updErr.message);
    }

    return jsonResponse(200, {
      jobId,
      reconciliation_run_id: reconciliationRunId,
      executionArn,
      reused: false,
      preflight: pre,
      bucket_counts: {
        utah: utahCompanyIds.length,
        florida: floridaCompanyIds.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('State matching StartExecution failed', msg);
    await leadsClient
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', jobId);
    await leadsClient
      .from('reconciliation_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        meta: {
          run_kind: 'state_matching_orchestration',
          preflight: pre,
          error: msg,
        },
      })
      .eq('id', reconciliationRunId);
    return jsonResponse(502, { error: 'Failed to start workflow', detail: msg });
  }
}

async function handleListJobs(leadsClient: SupabaseClient, rawQueryString: string): Promise<FunctionUrlResponse> {
  const limit = parseLimit(rawQueryString, 100, 50);
  const params = new URLSearchParams(rawQueryString || '');
  const status = params.get('status')?.trim() || undefined;

  let q = leadsClient
    .from('foundry_jobs')
    .select(
      'id, job_type, status, requested_by, payload, progress, error_summary, idempotency_key, step_function_execution_arn, started_at, completed_at, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    console.error('foundry_jobs list failed', error.message);
    return jsonResponse(502, { error: 'Failed to load jobs' });
  }
  return jsonResponse(200, { jobs: data ?? [] });
}

async function handleGetJob(leadsClient: SupabaseClient, id: string): Promise<FunctionUrlResponse> {
  const { data, error } = await leadsClient
    .from('foundry_jobs')
    .select(
      'id, job_type, status, requested_by, payload, progress, error_summary, idempotency_key, step_function_execution_arn, started_at, completed_at, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('foundry_jobs get failed', error.message);
    return jsonResponse(502, { error: 'Failed to load job' });
  }
  if (!data) return jsonResponse(404, { error: 'Job not found' });
  return jsonResponse(200, { job: data });
}

async function handlePostNormalizeJob(
  leadsClient: SupabaseClient,
  runId: string,
  rawBody: string,
  userId: string,
): Promise<FunctionUrlResponse> {
  const parsed = parseJsonBody<{ batchSize?: number }>(rawBody || '{}');
  if (!parsed.ok) return parsed.response;
  const batchSize = Math.min(2000, Math.max(1, Number(parsed.value.batchSize) || 500));

  const outcome = await startNormalizeIngestionJob(leadsClient, runId, userId, { batchSize });
  if (outcome.status === 'started') {
    return jsonResponse(200, {
      jobId: outcome.jobId,
      executionArn: outcome.executionArn,
      reused: outcome.reused,
    });
  }
  if (outcome.code === 'not_configured') {
    return jsonResponse(503, { error: outcome.error });
  }
  if (outcome.code === 'not_found') {
    return jsonResponse(404, { error: outcome.error });
  }
  const body: Record<string, string> = { error: outcome.error };
  if (outcome.detail) body.detail = outcome.detail;
  return jsonResponse(502, body);
}

async function handlePostAutolinkJob(
  leadsClient: SupabaseClient,
  runId: string,
  rawBody: string,
  userId: string,
): Promise<FunctionUrlResponse> {
  const parsed = parseJsonBody<{ batchSize?: number }>(rawBody || '{}');
  if (!parsed.ok) return parsed.response;
  const batchSize = Math.min(500, Math.max(1, Number(parsed.value.batchSize) || 100));

  const outcome = await startAutolinkIngestionJob(leadsClient, runId, userId, { batchSize });
  if (outcome.status === 'started') {
    return jsonResponse(200, {
      jobId: outcome.jobId,
      executionArn: outcome.executionArn,
      reused: outcome.reused,
    });
  }
  if (outcome.code === 'not_configured') {
    return jsonResponse(503, { error: outcome.error });
  }
  if (outcome.code === 'not_found') {
    return jsonResponse(404, { error: outcome.error });
  }
  const body: Record<string, string> = { error: outcome.error };
  if (outcome.detail) body.detail = outcome.detail;
  return jsonResponse(502, body);
}

async function handlePostContactEnrichmentJob(
  leadsClient: SupabaseClient,
  runId: string,
  rawBody: string,
  userId: string,
): Promise<FunctionUrlResponse> {
  const parsed = parseJsonBody<{
    freshness_window_days?: number;
    force_rerun_recent?: boolean;
    strong_targets_only?: boolean;
    batchSize?: number;
    ruleset_preset?: string;
    queue_ambiguous_for_review?: boolean;
    cost_per_lookup_cents?: number;
  }>(rawBody || '{}');
  if (!parsed.ok) return parsed.response;

  const rp = parsed.value.ruleset_preset;
  const rulesetPreset =
    rp === 'conservative' || rp === 'balanced' || rp === 'aggressive' ? rp : undefined;

  const costPerLookup =
    typeof parsed.value.cost_per_lookup_cents === 'number' && Number.isFinite(parsed.value.cost_per_lookup_cents)
      ? Math.trunc(parsed.value.cost_per_lookup_cents)
      : undefined;

  const outcome = await startContactEnrichmentIngestionJob(leadsClient, runId, userId, {
    freshnessWindowDays: parsed.value.freshness_window_days,
    forceRerunRecent: parsed.value.force_rerun_recent,
    strongTargetsOnly: parsed.value.strong_targets_only,
    batchSize: parsed.value.batchSize,
    rulesetPreset,
    queueAmbiguousForReview: parsed.value.queue_ambiguous_for_review,
    costPerLookupCents: costPerLookup,
  });
  if (outcome.status === 'started') {
    return jsonResponse(200, {
      jobId: outcome.jobId,
      executionArn: outcome.executionArn,
      reused: outcome.reused,
      preflight: outcome.preflight,
    });
  }
  if (outcome.code === 'not_configured') {
    return jsonResponse(503, { error: outcome.error });
  }
  if (outcome.code === 'not_found') {
    return jsonResponse(404, { error: outcome.error });
  }
  if (outcome.code === 'not_eligible') {
    return jsonResponse(400, { error: outcome.error, preflight: outcome.preflight });
  }
  const body: Record<string, unknown> = { error: outcome.error };
  if (outcome.detail) body.detail = outcome.detail;
  if (outcome.preflight) body.preflight = outcome.preflight;
  return jsonResponse(502, body);
}

async function getLatestJobForRun(
  leadsClient: SupabaseClient,
  jobType: string,
  payloadFilter: Record<string, unknown>,
) {
  const { data, error } = await leadsClient
    .from('foundry_jobs')
    .select(
      'id, job_type, status, requested_by, payload, progress, error_summary, idempotency_key, step_function_execution_arn, started_at, completed_at, created_at, updated_at',
    )
    .eq('job_type', jobType)
    .contains('payload', payloadFilter)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getQueuePendingTasksForRun(leadsClient: SupabaseClient, runId: string): Promise<number | null> {
  const { data, error } = await leadsClient.rpc('get_ingestion_run_queue_pending_tasks', {
    run_id: runId,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : null;
}

function stateMatchingRunIdFromJob(job: Awaited<ReturnType<typeof getLatestJobForRun>>): string | null {
  const runId = job?.payload?.reconciliation_run_id;
  return typeof runId === 'string' && runId.trim() ? runId.trim() : null;
}

async function handleGetPipelineJobs(leadsClient: SupabaseClient, runId: string): Promise<FunctionUrlResponse> {
  try {
    const [totalSourceRows, normalizeJob, autolinkJob, contactEnrichmentJob, stateMatchingJob] = await Promise.all([
      countSourceRowsForRun(leadsClient, runId),
      getLatestJobForRun(leadsClient, 'normalize_ingestion_run', { ingestion_run_id: runId }),
      getLatestJobForRun(leadsClient, 'autolink_ingestion_run', { ingestion_run_id: runId }),
      getLatestJobForRun(leadsClient, 'contact_enrichment_import_run', { ingestion_run_id: runId }),
      getLatestJobForRun(leadsClient, 'state_matching_batch', { source_ingestion_run_id: runId }),
    ]);

    let queuePendingTasks: number | null = null;
    let stateMatchingOutcomeCounts: Record<string, number> | null = null;
    try {
      queuePendingTasks = await getQueuePendingTasksForRun(leadsClient, runId);
    } catch (queueErr) {
      const message = queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error('pipeline jobs queue count failed', runId, message);
    }
    const stateMatchingRunId = stateMatchingRunIdFromJob(stateMatchingJob);
    if (stateMatchingRunId && (stateMatchingJob?.status === 'queued' || stateMatchingJob?.status === 'running')) {
      try {
        stateMatchingOutcomeCounts = await getReconciliationOutcomeCounts(
          leadsClient as unknown as Parameters<typeof getReconciliationOutcomeCounts>[0],
          stateMatchingRunId,
        );
      } catch (stateMatchingErr) {
        const message = stateMatchingErr instanceof Error ? stateMatchingErr.message : String(stateMatchingErr);
        console.error('pipeline jobs state matching counts failed', runId, message);
      }
    }

    return jsonResponse(200, {
      ingestion_run_id: runId,
      total_source_rows: totalSourceRows,
      normalize_job: normalizeJob,
      autolink_job: autolinkJob,
      contact_enrichment_job: contactEnrichmentJob,
      state_matching_job: stateMatchingJob,
      state_matching_outcome_counts: stateMatchingOutcomeCounts,
      queue_pending_tasks: queuePendingTasks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('pipeline jobs lookup failed', message);
    return jsonResponse(502, { error: 'Failed to load pipeline jobs', detail: message });
  }
}

async function handlePostImportScopedStateMatching(
  leadsClient: SupabaseClient,
  runId: string,
  userId: string,
): Promise<FunctionUrlResponse> {
  try {
    const companyIds = await collectLinkedCompanyIdsForIngestionRun(leadsClient, runId);
    return startStateMatchingBatchJob(leadsClient, companyIds, userId, {
      sourceIngestionRunId: runId,
      importScoped: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('import-scoped state matching failed', message);
    return jsonResponse(502, { error: 'Failed to start import-scoped state matching', detail: message });
  }
}
