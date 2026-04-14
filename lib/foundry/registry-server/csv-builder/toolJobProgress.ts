import type { SupabaseClient } from '@supabase/supabase-js';

export interface CsvBuilderToolJobProgressCounts {
  rows_total: number;
  rows_completed: number;
  rows_failed: number;
  batches_total: number;
  batches_completed: number;
  batches_failed: number;
}

export interface CsvBuilderWebsiteToolJobProgressCounts extends CsvBuilderToolJobProgressCounts {
  outcome_usable: number;
  outcome_uncertain: number;
  outcome_not_usable: number;
  outcome_error: number;
}

export interface CsvBuilderGoogleAdsToolJobProgressCounts extends CsvBuilderToolJobProgressCounts {
  outcome_yes: number;
  outcome_no: number;
  outcome_unknown: number;
  outcome_error: number;
}

export interface CsvBuilderToolJobPayloadMeta {
  rows_total: number;
  batch_size: number | null;
  batch_count: number | null;
  max_concurrency: number | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asInt(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value ?? 0) || 0));
}

function asNullableInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : null;
}

export function csvBuilderToolJobPayloadMeta(
  payload: Record<string, unknown> | null | undefined,
): CsvBuilderToolJobPayloadMeta {
  const p = payload ?? {};
  return {
    rows_total: asInt(p.rows_total),
    batch_size: asNullableInt(p.batch_size),
    batch_count: asNullableInt(p.batch_count),
    max_concurrency: asNullableInt(p.map_max_concurrency),
  };
}

function currentStep(
  status: string,
  previous: Record<string, unknown> | null | undefined,
): string {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'queued') return 'queued';
  const existing = typeof previous?.current_step === 'string' && previous.current_step.trim() ? previous.current_step.trim() : null;
  return existing ?? 'running';
}

export async function loadCsvBuilderToolJobProgressCounts(
  leadsClient: SupabaseClient,
  toolJobId: string,
): Promise<CsvBuilderToolJobProgressCounts> {
  const { data, error } = await leadsClient
    .rpc('get_csv_builder_tool_job_progress', { p_tool_job_id: toolJobId })
    .single();
  if (error) throw new Error(error.message);
  const row = asObject(data);
  return {
    rows_total: asInt(row.rows_total),
    rows_completed: asInt(row.rows_completed),
    rows_failed: asInt(row.rows_failed),
    batches_total: asInt(row.batches_total),
    batches_completed: asInt(row.batches_completed),
    batches_failed: asInt(row.batches_failed),
  };
}

export async function loadCsvBuilderWebsiteVerificationToolJobProgressCounts(
  leadsClient: SupabaseClient,
  toolJobId: string,
): Promise<CsvBuilderWebsiteToolJobProgressCounts> {
  const { data, error } = await leadsClient
    .rpc('get_csv_builder_website_verification_tool_job_progress', { p_tool_job_id: toolJobId })
    .single();
  if (error) throw new Error(error.message);
  const row = asObject(data);
  return {
    rows_total: asInt(row.rows_total),
    rows_completed: asInt(row.rows_completed),
    rows_failed: asInt(row.rows_failed),
    batches_total: asInt(row.batches_total),
    batches_completed: asInt(row.batches_completed),
    batches_failed: asInt(row.batches_failed),
    outcome_usable: asInt(row.outcome_usable),
    outcome_uncertain: asInt(row.outcome_uncertain),
    outcome_not_usable: asInt(row.outcome_not_usable),
    outcome_error: asInt(row.outcome_error),
  };
}

export async function loadCsvBuilderGoogleAdsToolJobProgressCounts(
  leadsClient: SupabaseClient,
  toolJobId: string,
): Promise<CsvBuilderGoogleAdsToolJobProgressCounts> {
  const { data, error } = await leadsClient
    .rpc('get_csv_builder_google_ads_tool_job_progress', { p_tool_job_id: toolJobId })
    .single();
  if (error) throw new Error(error.message);
  const row = asObject(data);
  return {
    rows_total: asInt(row.rows_total),
    rows_completed: asInt(row.rows_completed),
    rows_failed: asInt(row.rows_failed),
    batches_total: asInt(row.batches_total),
    batches_completed: asInt(row.batches_completed),
    batches_failed: asInt(row.batches_failed),
    outcome_yes: asInt(row.outcome_yes),
    outcome_no: asInt(row.outcome_no),
    outcome_unknown: asInt(row.outcome_unknown),
    outcome_error: asInt(row.outcome_error),
  };
}

export function buildCsvBuilderToolJobProgressSnapshot(
  payload: Record<string, unknown> | null | undefined,
  counts: CsvBuilderToolJobProgressCounts,
  opts?: {
    status?: string | null;
    previous?: Record<string, unknown> | null | undefined;
    refreshed_at?: string;
  },
): Record<string, unknown> {
  const previous = opts?.previous ?? {};
  const meta = csvBuilderToolJobPayloadMeta(payload);
  return {
    ...previous,
    current_step: currentStep(String(opts?.status ?? 'running'), previous),
    total_rows: counts.rows_total || meta.rows_total,
    rows_processed: counts.rows_completed,
    rows_failed: counts.rows_failed,
    batch_size: meta.batch_size,
    batches_total: counts.batches_total || meta.batch_count,
    batches_completed: counts.batches_completed,
    batches_failed: counts.batches_failed,
    max_concurrency: meta.max_concurrency,
    last_progress_refresh_at: opts?.refreshed_at ?? new Date().toISOString(),
  };
}

export function buildCsvBuilderWebsiteVerificationToolJobProgressSnapshot(
  payload: Record<string, unknown> | null | undefined,
  counts: CsvBuilderWebsiteToolJobProgressCounts,
  opts?: {
    status?: string | null;
    previous?: Record<string, unknown> | null | undefined;
    refreshed_at?: string;
  },
): Record<string, unknown> {
  return {
    ...buildCsvBuilderToolJobProgressSnapshot(payload, counts, opts),
    outcome_usable: counts.outcome_usable,
    outcome_uncertain: counts.outcome_uncertain,
    outcome_not_usable: counts.outcome_not_usable,
    outcome_error: counts.outcome_error,
  };
}

export function buildCsvBuilderGoogleAdsToolJobProgressSnapshot(
  payload: Record<string, unknown> | null | undefined,
  counts: CsvBuilderGoogleAdsToolJobProgressCounts,
  opts?: {
    status?: string | null;
    previous?: Record<string, unknown> | null | undefined;
    refreshed_at?: string;
  },
): Record<string, unknown> {
  return {
    ...buildCsvBuilderToolJobProgressSnapshot(payload, counts, opts),
    outcome_yes: counts.outcome_yes,
    outcome_no: counts.outcome_no,
    outcome_unknown: counts.outcome_unknown,
    outcome_error: counts.outcome_error,
  };
}
