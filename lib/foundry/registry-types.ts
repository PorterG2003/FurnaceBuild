/**
 * Types for the registry (leads) Supabase project — kept separate from
 * lib/supabase/types/database.ts (main app DB).
 *
 * Pipeline string literals mirror CHECK constraints in
 * supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql
 * (and company_entity_matches_status_check in init_registry_schema).
 */

export const SOURCE_BUSINESS_LINK_STATUSES = ['candidate', 'linked', 'rejected'] as const;
export type SourceBusinessLinkStatus = (typeof SOURCE_BUSINESS_LINK_STATUSES)[number];

export const COMPANY_ENTITY_MATCH_STATUSES = ['candidate', 'promoted', 'rejected'] as const;
export type CompanyEntityMatchStatus = (typeof COMPANY_ENTITY_MATCH_STATUSES)[number];

export const RECONCILIATION_OUTCOMES = ['matched', 'no_match', 'ambiguous', 'error'] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export const REVIEW_TASK_TYPES = [
  'source_link_review',
  'company_dedupe',
  'entity_match_review',
  'parse_failure',
] as const;
export type ReviewTaskType = (typeof REVIEW_TASK_TYPES)[number];

export const REVIEW_TASK_STATUSES = ['pending', 'in_progress', 'resolved', 'cancelled'] as const;
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

/** foundry_jobs.status — mirrors supabase-leads migration 20260326120000_foundry_jobs.sql */
export const FOUNDRY_JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type FoundryJobStatus = (typeof FOUNDRY_JOB_STATUSES)[number];

/** foundry_jobs.job_type */
export const FOUNDRY_JOB_TYPES = [
  'normalize_ingestion_run',
  'bulk_source_resolution',
  'state_matching_batch',
] as const;
export type FoundryJobType = (typeof FOUNDRY_JOB_TYPES)[number];

/** Optional progress JSON on foundry_jobs (UI / workers). */
export interface FoundryJobProgress {
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  current_step?: string;
  /** Last source_business_records.id processed in normalize chunk loop */
  cursor?: string | null;
  last_chunk?: { updated: number; scanned: number };
}

export interface FoundryJobRow {
  id: string;
  job_type: string;
  status: string;
  requested_by: string | null;
  payload: Record<string, unknown>;
  progress: FoundryJobProgress;
  error_summary: string | null;
  idempotency_key: string | null;
  step_function_execution_arn: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FoundryJobDetailResponse {
  job: FoundryJobRow;
}

export interface FoundryJobsListResponse {
  jobs: FoundryJobRow[];
}

export interface PostStartNormalizeJobResponse {
  jobId: string;
  executionArn: string;
  reused?: boolean;
}

export interface RegistryCompany {
  id: string;
  legal_name: string;
  normalized_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegistryCompaniesResponse {
  companies: RegistryCompany[];
}

/** ingestion_runs row shape from Foundry API (leads DB). */
export interface IngestionRunRow {
  id: string;
  source_name: string;
  source_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  config: Record<string, unknown>;
  stats: IngestionRunStats;
  /** Present on detail fetch; list endpoint may omit. */
  error_summary?: string | null;
  created_at: string;
  parser_version: string | null;
  ingest_version: string | null;
}

export interface IngestionRunStats {
  total_rows?: number;
  valid_rows?: number;
  warning_rows?: number;
  error_rows?: number;
  imported_rows?: number;
  skipped_rows?: number;
  failed_rows?: number;
}

export interface IngestionRunsListResponse {
  runs: IngestionRunRow[];
}

export interface IngestionRunDetailResponse {
  run: IngestionRunRow;
}

export interface ImportedRecordRow {
  id: string;
  name_raw: string;
  website: string | null;
  address_raw: string | null;
  observed_at: string;
  ingestion_run_id: string;
  link_status: string;
  import_validation: string | null;
  review_status: '—';
  source_row_number: number | null;
  /** From resolution_meta when present */
  normalized_name_key?: string | null;
  inferred_state_region?: string | null;
}

export interface IngestionRunRecordsResponse {
  records: ImportedRecordRow[];
  limit: number;
  offset: number;
}

export interface GoogleMapsColumnMapPayload {
  nameRawHeader: string;
  addressRawHeader: string;
  websiteHeader: string | null;
}

export interface PostGoogleMapsImportBody {
  importName: string;
  notes?: string;
  sourceName?: string;
  importWarnings: boolean;
  columnMap: GoogleMapsColumnMapPayload;
  rows: Record<string, string>[];
}

export interface ImportErrorSample {
  rowNumber: number;
  issues: string[];
  nameRaw: string;
  addressRaw: string;
}

export interface PostGoogleMapsImportResponse {
  runId: string;
  stats: IngestionRunStats;
  errorSamples: ImportErrorSample[];
  parserVersion: string;
  ingestVersion: string;
}

export interface SourceRecordDetailResponse {
  record: Record<string, unknown>;
  links: Record<string, unknown>[];
  companiesById: Record<string, { id: string; legal_name: string; normalized_key: string | null }>;
}

export interface NormalizeRunRecordsResponse {
  updated: number;
  scanned: number;
}

export interface ReviewTaskRow {
  id: string;
  task_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  priority: number;
  assigned_to: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ReviewTasksListResponse {
  tasks: ReviewTaskRow[];
}

export interface StateMatchingPreflightResponse {
  ready: string[];
  missing_state: string[];
  already_matched: string[];
  not_linked: string[];
}

export interface CompanyDetailResponse {
  company: Record<string, unknown>;
  locations: Record<string, unknown>[];
  source_links: Record<string, unknown>[];
  entity_matches: Record<string, unknown>[];
}
