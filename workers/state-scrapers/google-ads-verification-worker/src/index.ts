import { randomUUID } from 'node:crypto';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import {
  GOOGLE_ADS_VERIFIER_VERSION,
  buildCsvBuilderGoogleAdsToolJobProgressSnapshot,
  buildCsvBuilderGoogleAdsRowResult,
  buildCsvBuilderGoogleAdsSkippedResult,
  buildGoogleAdsVerificationProgressSnapshot,
  extractCsvBuilderToolOutputValue,
  loadCsvBuilderGoogleAdsToolJobProgressCounts,
  loadGoogleAdsVerificationProgressCounts,
  loadGoogleAdsVerificationTargets,
  pickGoogleAdsVerificationTarget,
  computeCostAmountMicros,
  insertDirectCostRecord,
  resolveCsvBuilderGoogleAdsLookupTarget,
  resolveRunCost,
  csvBuilderGoogleAdsSkipReason,
} from '@furnace/registry-server';
import { runGoogleAdsTransparencyLookup } from './transparencyLookup.js';

type JobProgress = Record<string, unknown> & {
  in_scope_total?: number;
  companies_processed?: number;
  outcome_yes?: number;
  outcome_no?: number;
  outcome_unknown?: number;
  outcome_error?: number;
  outcome_skipped?: number;
  companies_with_result?: number;
  current_step?: string;
};

function logEvent(event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: 'google-ads-verification', event, at: new Date().toISOString(), ...data }));
}

async function fetchSecretFromParameterStore(parameterPath: string, region: string): Promise<string> {
  const ssmClient = new SSMClient({ region });
  const response = await ssmClient.send(new GetParameterCommand({ Name: parameterPath, WithDecryption: true }));
  if (!response.Parameter?.Value?.trim()) {
    throw new Error(`Parameter ${parameterPath} has no value`);
  }
  return response.Parameter.Value.trim();
}

async function loadSecret(): Promise<{ url: string; key: string; jobId: string }> {
  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const jobId = process.env.JOB_ID?.trim();
  let key = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  const paramPath = process.env.LEADS_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
  const region = process.env.AWS_REGION || 'us-west-2';
  if (!url || !jobId) {
    throw new Error('Missing LEADS_SUPABASE_URL or JOB_ID');
  }
  if (!key && paramPath) {
    key = await fetchSecretFromParameterStore(paramPath, region);
  }
  if (!key) {
    throw new Error('Missing LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH');
  }
  return { url, key, jobId };
}

async function updateJobProgress(client: any, jobId: string, progress: JobProgress): Promise<void> {
  const { error } = await (client
    .from('foundry_jobs') as any)
    .update({ progress: { ...progress, current_step: 'running' } })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
}

type CsvBuilderRowRecord = {
  id: string;
  row_number: number;
  source_values: Record<string, unknown>;
  tool_values: Record<string, unknown>;
  row_status: string;
};

type CsvBuilderOutputColumn = {
  id: string;
  key: string;
  tool_output_key: string | null;
};

type CsvBuilderBatchRow = {
  id: string;
  batch_index: number;
  row_ids: string[];
  row_count: number;
  status: string;
  attempt_count: number;
};

type CsvBuilderRunColumn = {
  id: string;
  key: string;
  label: string;
  kind: string;
  position: number;
  tool_type?: string | null;
  tool_output_key: string | null;
};

async function loadCsvBuilderBatch(client: any, batchId: string): Promise<CsvBuilderBatchRow> {
  const { data, error } = await client
    .from('csv_builder_tool_job_batches')
    .select('id, batch_index, row_ids, row_count, status, attempt_count')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? `CSV Builder batch ${batchId} not found`);
  return data as CsvBuilderBatchRow;
}

async function loadCsvBuilderRowsForBatch(
  client: any,
  rowIds: string[],
): Promise<CsvBuilderRowRecord[]> {
  if (rowIds.length === 0) return [];
  const { data, error } = await client
    .from('csv_builder_rows')
    .select('id, row_number, source_values, tool_values, row_status')
    .in('id', rowIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CsvBuilderRowRecord[]).sort((a, b) => a.row_number - b.row_number);
}

function csvBuilderRowValues(
  row: CsvBuilderRowRecord,
  columnIdToKey: Map<string, string>,
  inputMapping: Record<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [inputKey, columnId] of Object.entries(inputMapping)) {
    const columnKey = columnIdToKey.get(columnId);
    if (!columnKey) continue;
    if (Object.prototype.hasOwnProperty.call(row.tool_values ?? {}, columnKey)) {
      values[inputKey] = row.tool_values[columnKey];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(row.source_values ?? {}, columnKey)) {
      values[inputKey] = row.source_values[columnKey];
      continue;
    }
    values[inputKey] = null;
  }
  return values;
}

function hasUsableValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function recoverGoogleAdsBuilderInputs(
  row: CsvBuilderRowRecord,
  rowValues: Record<string, unknown>,
  columns: CsvBuilderRunColumn[],
): Record<string, unknown> {
  const recovered = { ...rowValues };
  if (!hasUsableValue(recovered.website_verification_final_url)) {
    const finalUrlColumn = columns.find(
      (column) => column.tool_type === 'website_verification' && column.tool_output_key === 'final_url',
    );
    if (finalUrlColumn && Object.prototype.hasOwnProperty.call(row.tool_values ?? {}, finalUrlColumn.key)) {
      recovered.website_verification_final_url = row.tool_values[finalUrlColumn.key];
    }
  }
  if (!hasUsableValue(recovered.website)) {
    const websiteColumn = columns.find(
      (column) => column.kind === 'source' && /website|url|domain|homepage|site/i.test(column.label),
    );
    if (websiteColumn && Object.prototype.hasOwnProperty.call(row.source_values ?? {}, websiteColumn.key)) {
      recovered.website = row.source_values[websiteColumn.key];
    }
  }
  return recovered;
}

async function refreshCsvBuilderGoogleAdsProgress(
  client: any,
  jobId: string,
  toolJobId: string,
  payload: Record<string, unknown>,
  previous: JobProgress,
): Promise<JobProgress> {
  const counts = await loadCsvBuilderGoogleAdsToolJobProgressCounts(
    client as unknown as Parameters<typeof loadCsvBuilderGoogleAdsToolJobProgressCounts>[0],
    toolJobId,
  );
  const progress = buildCsvBuilderGoogleAdsToolJobProgressSnapshot(payload, counts, {
    status: 'running',
    previous,
  }) as JobProgress;
  await updateJobProgress(client, jobId, progress);
  const { error } = await client
    .from('csv_builder_column_jobs')
    .update({
      status: 'running',
      rows_total: counts.rows_total,
      rows_completed: counts.rows_completed,
      rows_failed: counts.rows_failed,
      completed_at: null,
      error_summary: counts.rows_failed > 0 ? `${counts.rows_failed} rows failed` : null,
    })
    .eq('id', toolJobId);
  if (error) throw new Error(error.message);
  return progress;
}

async function runCsvBuilderGoogleAdsVerification(
  client: any,
  jobId: string,
  payload: Record<string, unknown>,
  previousProgress: JobProgress,
): Promise<void> {
  const toolJobId =
    typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0
      ? payload.csv_builder_tool_job_id.trim()
      : null;
  const runId = typeof payload.run_id === 'string' && payload.run_id.trim().length > 0 ? payload.run_id.trim() : null;
  const batchId = process.env.CSV_BUILDER_BATCH_ID?.trim() || null;
  if (!toolJobId || !runId || !batchId) throw new Error('Missing CSV Builder tool job payload');
  const { data: toolJob, error: toolJobErr } = await client
    .from('csv_builder_column_jobs')
    .select('*')
    .eq('id', toolJobId)
    .maybeSingle();
  if (toolJobErr || !toolJob) throw new Error(toolJobErr?.message ?? `CSV Builder tool job ${toolJobId} not found`);
  const { data: columnsData, error: columnsErr } = await client
    .from('csv_builder_columns')
    .select('id, key, label, kind, position, tool_type, tool_output_key')
    .eq('run_id', runId);
  if (columnsErr) throw new Error(columnsErr.message);
  const columns = ((columnsData ?? []) as CsvBuilderRunColumn[]).sort((a, b) => a.position - b.position);
  const columnIdToKey = new Map(columns.map((column) => [column.id, column.key]));
  const outputColumns = columns.filter((column) => (toolJob.output_column_ids ?? []).includes(column.id)) as CsvBuilderOutputColumn[];
  const batch = await loadCsvBuilderBatch(client, batchId);
  const { error: batchStartErr } = await client
    .from('csv_builder_tool_job_batches')
    .update({
      status: 'running',
      attempt_count: Math.max(0, Math.trunc(Number(batch.attempt_count ?? 0) || 0)) + 1,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_summary: null,
    })
    .eq('id', batchId);
  if (batchStartErr) throw new Error(batchStartErr.message);
  const rows = await loadCsvBuilderRowsForBatch(client, batch.row_ids ?? []);
  let progress = await refreshCsvBuilderGoogleAdsProgress(client, jobId, toolJobId, payload, previousProgress);
  try {
    let processedSinceRefresh = 0;
    for (const row of rows) {
      const mappedValues = csvBuilderRowValues(row, columnIdToKey, (toolJob.config?.input_mapping ?? {}) as Record<string, string>);
      const rowValues = recoverGoogleAdsBuilderInputs(row, mappedValues, columns);
      const lookupTarget = resolveCsvBuilderGoogleAdsLookupTarget(rowValues, toolJob.config);
      let result: Record<string, unknown>;
      let failed = false;
      let status: 'completed' | 'failed' | 'skipped' = 'completed';
      let outcomeCode: 'yes' | 'no' | 'unknown' = 'unknown';
      let errorSummary: string | null = null;
      if (!lookupTarget) {
        const skipReason = csvBuilderGoogleAdsSkipReason(rowValues);
        result = buildCsvBuilderGoogleAdsSkippedResult(
          skipReason === 'missing'
            ? 'No website or URL to look up'
            : 'Skipped: value is not a valid URL or domain',
        );
        status = 'skipped';
      } else {
        try {
          const lookup = await runGoogleAdsTransparencyLookup({
            domain: lookupTarget.search_domain,
            headless: false,
            region: 'US',
            timeoutMs: 20_000,
          });
          result = buildCsvBuilderGoogleAdsRowResult({
            input_url: lookupTarget.input_url,
            search_domain: lookupTarget.search_domain,
            result: lookup.result,
            matched_advertiser_name: lookup.matched_advertiser_name,
            advertiser_url: lookup.advertiser_url,
            matched_advertiser_id: lookup.matched_advertiser_id,
            latest_ad_last_shown_at: lookup.latest_ad_last_shown_at,
            signals: (lookup.signals ?? {}) as Record<string, unknown>,
            lookup_stats: (lookup.lookup_stats ?? {}) as Record<string, unknown>,
            error: lookup.error ?? null,
          });
          outcomeCode = lookup.result === 'yes' || lookup.result === 'no' ? lookup.result : 'unknown';
          if (lookup.error) {
            failed = true;
            status = 'failed';
            errorSummary = lookup.error;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed = true;
          status = 'failed';
          errorSummary = message;
          result = buildCsvBuilderGoogleAdsSkippedResult(message);
        }
      }
      const patch: Record<string, unknown> = {};
      for (const column of outputColumns) {
        if (!column.tool_output_key) continue;
        patch[column.key] = extractCsvBuilderToolOutputValue('google_ads_verification', column.tool_output_key, result) ?? null;
      }
      const { error: applyErr } = await client.rpc('apply_csv_builder_tool_job_row_result', {
        p_tool_job_id: toolJobId,
        p_batch_id: batchId,
        p_row_id: row.id,
        p_row_number: row.row_number,
        p_tool_type: 'google_ads_verification',
        p_status: status,
        p_failed: failed,
        p_outcome_code: outcomeCode,
        p_error_summary: errorSummary,
        p_result_payload: result,
        p_output_patch: patch,
      });
      if (applyErr) throw new Error(applyErr.message);
      processedSinceRefresh += 1;
      if (processedSinceRefresh >= 5 || processedSinceRefresh === rows.length) {
        progress = await refreshCsvBuilderGoogleAdsProgress(client, jobId, toolJobId, payload, progress);
        processedSinceRefresh = 0;
      }
    }
    const { error: batchCompleteErr } = await client
      .from('csv_builder_tool_job_batches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_summary: null,
      })
      .eq('id', batchId);
    if (batchCompleteErr) throw new Error(batchCompleteErr.message);
    await refreshCsvBuilderGoogleAdsProgress(client, jobId, toolJobId, payload, progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .from('csv_builder_tool_job_batches')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: message,
      })
      .eq('id', batchId);
    throw error;
  }
}

async function main(): Promise<void> {
  const jobKind = process.env.JOB_KIND?.trim();
  if (jobKind === 'flux_competitor_audit') {
    const raw = process.env.FLUX_AUDIT_JOB_JSON?.trim();
    if (!raw) throw new Error('Missing FLUX_AUDIT_JOB_JSON');
    const parsed = JSON.parse(raw) as { jobId?: string };
    const jobId = typeof parsed.jobId === 'string' ? parsed.jobId.trim() : '';
    if (!jobId) throw new Error('FLUX_AUDIT_JOB_JSON.jobId required');
    const region = process.env.AWS_REGION || 'us-west-2';
    const { runFluxCompetitorAuditJob } = await import('./fluxCompetitorAuditRun.js');
    await runFluxCompetitorAuditJob({ jobId, awsRegion: region });
    return;
  }

  const { url, key, jobId } = await loadSecret();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const runtimeCost = await resolveRunCost(
    client as any,
    'enrichment',
    'furnace_runtime',
    'google_ads_verification_ms',
    undefined,
    { usageUnit: 'ms', unitQuantity: 3600000 },
  );
  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload, progress')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    throw new Error(jobErr?.message || `Job ${jobId} not found`);
  }

  const payload = (jobRow.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0) {
    await runCsvBuilderGoogleAdsVerification(client, jobId, payload, ((jobRow.progress ?? {}) as JobProgress) || {});
    return;
  }
  const companyIds = Array.isArray(payload.company_ids)
    ? payload.company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const readyCompanyIds = Array.isArray(payload.ready_company_ids)
    ? payload.ready_company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const scopedCompanyIds = readyCompanyIds.length > 0 ? readyCompanyIds : companyIds;
  const sourceIngestionRunId =
    typeof payload.source_ingestion_run_id === 'string' && payload.source_ingestion_run_id.trim().length > 0
      ? payload.source_ingestion_run_id.trim()
      : null;
  const progress = ((jobRow.progress ?? {}) as JobProgress) || {};
  progress.in_scope_total = progress.in_scope_total ?? scopedCompanyIds.length;
  progress.companies_processed = progress.companies_processed ?? 0;
  progress.outcome_yes = progress.outcome_yes ?? 0;
  progress.outcome_no = progress.outcome_no ?? 0;
  progress.outcome_unknown = progress.outcome_unknown ?? 0;
  progress.outcome_error = progress.outcome_error ?? 0;
  progress.outcome_skipped = progress.outcome_skipped ?? 0;
  progress.companies_with_result = progress.companies_with_result ?? 0;

  const targets = await loadGoogleAdsVerificationTargets(
    client as unknown as Parameters<typeof loadGoogleAdsVerificationTargets>[0],
    scopedCompanyIds,
  );

  logEvent('worker-start', {
    jobId,
    companies: scopedCompanyIds.length,
    requestedCompanies: companyIds.length,
    sourceIngestionRunId,
  });

  for (const target of targets) {
    const lookupTarget = pickGoogleAdsVerificationTarget(target);
    if (!lookupTarget) {
      continue;
    }

    try {
      const result = await runGoogleAdsTransparencyLookup({
        domain: lookupTarget.search_domain,
        headless: false,
        region: 'US',
        timeoutMs: 20_000,
      });
      logEvent('company-result', {
        jobId,
        companyId: target.company_id,
        legalName: target.legal_name,
        inputUrl: lookupTarget.input_url,
        searchDomain: lookupTarget.search_domain,
        advertiserUrl: result.advertiser_url ?? null,
        result: {
          status: result.result,
          advertiserId: result.matched_advertiser_id,
          advertiserName: result.matched_advertiser_name,
          error: result.error ?? null,
        },
      });
      const verificationId = randomUUID();
      const verifiedAt = new Date().toISOString();
      const elapsedMs =
        typeof result.lookup_stats?.elapsed_ms === 'number' && Number.isFinite(result.lookup_stats.elapsed_ms)
          ? Math.max(0, Math.trunc(result.lookup_stats.elapsed_ms))
          : null;
      const initialCostStatus =
        result.error == null && elapsedMs != null && runtimeCost != null
          ? 'costed'
          : result.error == null
            ? 'failed_or_not_costed'
            : 'failed_or_not_costed';
      const { error } = await (client.from('company_google_ads_verifications') as any).insert({
        id: verificationId,
        company_id: target.company_id,
        website_verification_id: target.website_verification_id,
        foundry_job_id: jobId,
        source_ingestion_run_id: sourceIngestionRunId,
        input_url: lookupTarget.input_url,
        search_domain: lookupTarget.search_domain,
        result: result.result,
        matched_advertiser_id: result.matched_advertiser_id,
        matched_advertiser_name: result.matched_advertiser_name,
        advertiser_url: result.advertiser_url,
        latest_ad_last_shown_at: result.latest_ad_last_shown_at,
        signals: result.signals,
        error: result.error ?? null,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: result.lookup_stats,
        elapsed_ms: elapsedMs,
        cost_status: initialCostStatus,
        verified_at: verifiedAt,
      });
      if (error) throw new Error(error.message);
      if (result.error == null && elapsedMs != null && runtimeCost != null) {
        try {
          const costRecord = await insertDirectCostRecord(client as any, {
            costKind: 'enrichment',
            provider: 'furnace_runtime',
            product: 'google_ads_verification_ms',
            usageQuantity: elapsedMs,
            usageUnit: 'ms',
            costAmountMicros: computeCostAmountMicros({
              usageQuantity: elapsedMs,
              unitPriceCents: runtimeCost.unitPriceCents,
              unitQuantity: runtimeCost.unitQuantity,
            }),
            costRateCardId: runtimeCost.rateCardId,
            costIsOverride: runtimeCost.isOverride,
            estimationKind: 'runtime_estimate',
            sourceEntityType: 'company_google_ads_verification',
            sourceEntityId: verificationId,
            companyId: target.company_id,
            ingestionRunId: sourceIngestionRunId,
            foundryJobId: jobId,
            meta: {
              result: result.result,
              search_domain: lookupTarget.search_domain,
            },
            createdAt: verifiedAt,
          });
          const { error: updError } = await (client.from('company_google_ads_verifications') as any)
            .update({ cost_record_id: costRecord.id, cost_status: 'costed' })
            .eq('id', verificationId);
          if (updError) throw new Error(updError.message);
        } catch (costError) {
          console.error('google ads cost write failed', verificationId, costError);
          await (client.from('company_google_ads_verifications') as any)
            .update({ cost_status: 'failed_or_not_costed' })
            .eq('id', verificationId);
        }
      }
      progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
      progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
      if (result.result === 'yes') progress.outcome_yes = Number(progress.outcome_yes ?? 0) + 1;
      if (result.result === 'no') progress.outcome_no = Number(progress.outcome_no ?? 0) + 1;
      if (result.result === 'unknown' && !result.error) {
        progress.outcome_unknown = Number(progress.outcome_unknown ?? 0) + 1;
      }
      if (result.error) progress.outcome_error = Number(progress.outcome_error ?? 0) + 1;
      await updateJobProgress(client, jobId, progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const verificationId = randomUUID();
      await (client.from('company_google_ads_verifications') as any).insert({
        id: verificationId,
        company_id: target.company_id,
        website_verification_id: target.website_verification_id,
        foundry_job_id: jobId,
        source_ingestion_run_id: sourceIngestionRunId,
        input_url: lookupTarget.input_url,
        search_domain: lookupTarget.search_domain,
        result: 'unknown',
        matched_advertiser_id: null,
        matched_advertiser_name: null,
        advertiser_url: null,
        latest_ad_last_shown_at: null,
        signals: { search_domain: lookupTarget.search_domain },
        error: message,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: { final_url: null },
        cost_status: 'failed_or_not_costed',
        verified_at: new Date().toISOString(),
      });
      progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
      progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
      progress.outcome_error = Number(progress.outcome_error ?? 0) + 1;
      await updateJobProgress(client, jobId, progress);
    }
  }

  const counts = await loadGoogleAdsVerificationProgressCounts(
    client as unknown as Parameters<typeof loadGoogleAdsVerificationProgressCounts>[0],
    jobId,
  );
  await updateJobProgress(
    client,
    jobId,
    buildGoogleAdsVerificationProgressSnapshot(payload, counts, {
      current_step: 'running',
      previous: progress,
    }) as JobProgress,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
