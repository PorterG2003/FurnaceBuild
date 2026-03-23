import { createHash } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bucketCompaniesForMatching,
  MATCHER_VERSION,
  NORMALIZER_VERSION,
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

  if (path === '/state-matching/batches' && method === 'POST') {
    const parsed = parseJsonBody<{ companyIds?: string[] }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const ids = parsed.value.companyIds ?? [];
    if (ids.length > 50) return jsonResponse(400, { error: 'At most 50 companies per batch' });
    return startStateMatchingBatchJob(leadsClient, ids, userId);
  }

  return null;
}

/** Async state matching: reconciliation_runs + foundry_jobs + Step Functions (mock Lambda + optional Utah ECS). */
export async function startStateMatchingBatchJob(
  leadsClient: SupabaseClient,
  companyIds: string[],
  userId: string,
): Promise<FunctionUrlResponse> {
  const smArn = process.env.FOUNDRY_STATE_MATCHING_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return jsonResponse(503, { error: 'Async state matching is not configured (Amplify backend / Step Functions)' });
  }

  const pre = await stateMatchingPreflight(leadsClient, { companyIds });
  const { mockCompanyIds, utahCompanyIds } = await bucketCompaniesForMatching(leadsClient, pre.ready);
  const versions = stateMatchingJobVersions();

  const sortedKey = [...companyIds].sort().join(',');
  const idempotencyKey = `state-match:${createHash('sha256').update(sortedKey).digest('hex').slice(0, 32)}:${MATCHER_VERSION}`;

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
    const pl = active.payload as { reconciliation_run_id?: string; preflight?: unknown };
    return jsonResponse(200, {
      jobId: active.id,
      reconciliation_run_id: String(pl.reconciliation_run_id ?? ''),
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
      preflight: pl.preflight ?? pre,
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
        mock_company_ids: mockCompanyIds,
        utah_company_ids: utahCompanyIds,
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
        company_ids: companyIds,
        preflight: pre,
        mock_company_ids: mockCompanyIds,
        utah_company_ids: utahCompanyIds,
      },
      idempotency_key: idempotencyKey,
      progress: { current_step: 'queued' },
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
        const pl = again.payload as { reconciliation_run_id?: string; preflight?: unknown };
        await leadsClient.from('reconciliation_runs').delete().eq('id', reconciliationRunId);
        return jsonResponse(200, {
          jobId: again.id,
          reconciliation_run_id: String(pl.reconciliation_run_id ?? ''),
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
          preflight: pl.preflight ?? pre,
        });
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return jsonResponse(502, { error: 'Failed to create job' });
  }

  const jobId = inserted.id as string;

  const utahCount = utahCompanyIds.length;
  const sfnInput = {
    jobId,
    reconciliationRunId,
    utahCount,
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
        progress: { current_step: 'running', utah_count: utahCount, mock_count: mockCompanyIds.length },
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
  const smArn = process.env.FOUNDRY_NORMALIZE_STATE_MACHINE_ARN?.trim();
  if (!smArn) {
    return jsonResponse(503, { error: 'Async normalize is not configured (check Amplify backend / deploy)' });
  }

  const parsed = parseJsonBody<{ batchSize?: number }>(rawBody || '{}');
  if (!parsed.ok) return parsed.response;
  const batchSize = Math.min(2000, Math.max(1, Number(parsed.value.batchSize) || 500));

  const { data: runRow, error: runErr } = await leadsClient
    .from('ingestion_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle();
  if (runErr) {
    console.error('ingestion_runs lookup failed', runErr.message);
    return jsonResponse(502, { error: 'Failed to verify ingestion run' });
  }
  if (!runRow) return jsonResponse(404, { error: 'Ingestion run not found' });

  const idempotencyKey = `normalize:${runId}:${NORMALIZER_VERSION}`;

  const { data: active, error: activeErr } = await leadsClient
    .from('foundry_jobs')
    .select('id, status, step_function_execution_arn')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'running'])
    .maybeSingle();

  if (activeErr) {
    console.error('foundry_jobs idempotency lookup failed', activeErr.message);
    return jsonResponse(502, { error: 'Failed to check existing job' });
  }

  if (active) {
    return jsonResponse(200, {
      jobId: active.id,
      executionArn: active.step_function_execution_arn ?? '',
      reused: true,
    });
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
        return jsonResponse(200, {
          jobId: again.id,
          executionArn: again.step_function_execution_arn ?? '',
          reused: true,
        });
      }
    }
    console.error('foundry_jobs insert failed', insErr?.message);
    return jsonResponse(502, { error: 'Failed to create job' });
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

    return jsonResponse(200, { jobId, executionArn, reused: false });
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
    return jsonResponse(502, { error: 'Failed to start workflow', detail: msg });
  }
}
