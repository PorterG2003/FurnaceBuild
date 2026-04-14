import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import {
  GOOGLE_ADS_VERIFIER_VERSION,
  buildCsvBuilderGoogleAdsRowResult,
  buildCsvBuilderGoogleAdsSkippedResult,
  buildGoogleAdsVerificationProgressSnapshot,
  extractCsvBuilderToolOutputValue,
  loadGoogleAdsVerificationProgressCounts,
  loadGoogleAdsVerificationTargets,
  pickGoogleAdsVerificationTarget,
  resolveCsvBuilderGoogleAdsLookupTarget,
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

type CsvBuilderRunColumn = {
  id: string;
  key: string;
  label: string;
  kind: string;
  position: number;
  tool_type?: string | null;
  tool_output_key: string | null;
};

async function scanCsvBuilderRows(client: any, runId: string): Promise<CsvBuilderRowRecord[]> {
  const rows: CsvBuilderRowRecord[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('csv_builder_rows')
      .select('id, row_number, source_values, tool_values, row_status')
      .eq('run_id', runId)
      .order('row_number', { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CsvBuilderRowRecord[];
    rows.push(...batch);
    if (batch.length < 500) break;
    from += 500;
  }
  return rows;
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

async function updateCsvBuilderGoogleAdsProgress(
  client: any,
  jobId: string,
  toolJobId: string,
  progress: {
    rows_total: number;
    rows_processed: number;
    rows_failed: number;
    outcome_yes: number;
    outcome_no: number;
    outcome_unknown: number;
  },
): Promise<void> {
  await updateJobProgress(client, jobId, {
    current_step: 'running',
    total_rows: progress.rows_total,
    rows_processed: progress.rows_processed,
    rows_failed: progress.rows_failed,
    outcome_yes: progress.outcome_yes,
    outcome_no: progress.outcome_no,
    outcome_unknown: progress.outcome_unknown,
  });
  const status =
    progress.rows_processed >= progress.rows_total
      ? progress.rows_failed > 0
        ? 'partial'
        : 'completed'
      : 'running';
  const { error } = await client
    .from('csv_builder_column_jobs')
    .update({
      status,
      rows_total: progress.rows_total,
      rows_completed: progress.rows_processed,
      rows_failed: progress.rows_failed,
      completed_at: progress.rows_processed >= progress.rows_total ? new Date().toISOString() : null,
      error_summary: progress.rows_failed > 0 ? `${progress.rows_failed} rows failed` : null,
    })
    .eq('id', toolJobId);
  if (error) throw new Error(error.message);
}

async function runCsvBuilderGoogleAdsVerification(client: any, jobId: string, payload: Record<string, unknown>): Promise<void> {
  const toolJobId =
    typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0
      ? payload.csv_builder_tool_job_id.trim()
      : null;
  const runId = typeof payload.run_id === 'string' && payload.run_id.trim().length > 0 ? payload.run_id.trim() : null;
  if (!toolJobId || !runId) throw new Error('Missing CSV Builder tool job payload');
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
  const rows = await scanCsvBuilderRows(client, runId);
  const progress = {
    rows_total: rows.length,
    rows_processed: 0,
    rows_failed: 0,
    outcome_yes: 0,
    outcome_no: 0,
    outcome_unknown: 0,
  };
  await updateCsvBuilderGoogleAdsProgress(client, jobId, toolJobId, progress);
  for (const row of rows) {
    const mappedValues = csvBuilderRowValues(row, columnIdToKey, (toolJob.config?.input_mapping ?? {}) as Record<string, string>);
    const rowValues = recoverGoogleAdsBuilderInputs(row, mappedValues, columns);
    const lookupTarget = resolveCsvBuilderGoogleAdsLookupTarget(rowValues, toolJob.config);
    let result: Record<string, unknown>;
    let failed = false;
    if (!lookupTarget) {
      const skipReason = csvBuilderGoogleAdsSkipReason(rowValues);
      result = buildCsvBuilderGoogleAdsSkippedResult(
        skipReason === 'missing'
          ? 'No website or URL to look up'
          : 'Skipped: value is not a valid URL or domain',
      );
      progress.outcome_unknown += 1;
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
          signals: (lookup.signals ?? {}) as Record<string, unknown>,
          lookup_stats: (lookup.lookup_stats ?? {}) as Record<string, unknown>,
          error: lookup.error ?? null,
        });
        if (lookup.result === 'yes') progress.outcome_yes += 1;
        else if (lookup.result === 'no') progress.outcome_no += 1;
        else progress.outcome_unknown += 1;
        if (lookup.error) {
          failed = true;
          progress.rows_failed += 1;
        }
      } catch (error) {
        failed = true;
        progress.rows_failed += 1;
        result = buildCsvBuilderGoogleAdsSkippedResult(error instanceof Error ? error.message : String(error));
      }
    }
    progress.rows_processed += 1;
    const patch: Record<string, unknown> = {};
    for (const column of outputColumns) {
      if (!column.tool_output_key) continue;
      patch[column.key] = extractCsvBuilderToolOutputValue('google_ads_verification', column.tool_output_key, result) ?? null;
    }
    const { error: rowErr } = await client
      .from('csv_builder_rows')
      .update({
        tool_values: { ...(row.tool_values ?? {}), ...patch },
        row_status: failed ? 'partial' : 'ready',
      })
      .eq('id', row.id);
    if (rowErr) throw new Error(rowErr.message);
    await updateCsvBuilderGoogleAdsProgress(client, jobId, toolJobId, progress);
  }
}

async function main(): Promise<void> {
  const { url, key, jobId } = await loadSecret();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
    await runCsvBuilderGoogleAdsVerification(client, jobId, payload);
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
      const { error } = await (client.from('company_google_ads_verifications') as any).insert({
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
        signals: result.signals,
        error: result.error ?? null,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: result.lookup_stats,
        verified_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
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
      await (client.from('company_google_ads_verifications') as any).insert({
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
        signals: { search_domain: lookupTarget.search_domain },
        error: message,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: { final_url: null },
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
