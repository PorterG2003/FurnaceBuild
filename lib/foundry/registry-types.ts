/**
 * Types for the registry (leads) Supabase project — kept separate from
 * lib/supabase/types/database.ts (main app DB).
 *
 * Pipeline string literals mirror CHECK constraints in
 * supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql
 * and 20260328120000_review_tasks_entity_owner_dedupe.sql (entity_owner_dedupe).
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
  'entity_owner_dedupe',
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
  /** Utah ECS worker: per-company outcomes */
  utah_per_company?: unknown[];
  utah_count?: number;
  /** Florida ECS worker: per-company outcomes */
  florida_per_company?: unknown[];
  florida_count?: number;
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

/** entity_owners row for Foundry dedupe / batch GET. */
export interface RegistryEntityOwnerRow {
  id: string;
  state_entity_id: string;
  owner_name: string;
  title_role: string | null;
  first_name: string | null;
  last_name: string | null;
  owner_normalized_key: string | null;
  is_current: boolean;
  observed_at: string;
}

export interface RegistryEntityOwnersResponse {
  entity_owners: RegistryEntityOwnerRow[];
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
  /** Present when link_status is linked; current source→company link company UUID */
  linked_company_id?: string | null;
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

/** Returned on every successful POST /imports/google-maps (row ingest may still be partial). */
export type ImportPipelineNormalize =
  | { status: 'started'; jobId: string; executionArn: string; reused: boolean }
  | { status: 'failed'; error: string; detail?: string; code?: string }
  | { status: 'skipped_no_rows' };

export interface ImportPipeline {
  normalize: ImportPipelineNormalize;
}

export interface PostGoogleMapsImportResponse {
  runId: string;
  stats: IngestionRunStats;
  errorSamples: ImportErrorSample[];
  parserVersion: string;
  ingestVersion: string;
  pipeline: ImportPipeline;
}

export interface SourceRecordDetailResponse {
  record: Record<string, unknown>;
  links: Record<string, unknown>[];
  companiesById: Record<string, { id: string; legal_name: string; normalized_key: string | null }>;
}

/** Response from POST /source-records/:id/candidates/generate (200). */
export interface GenerateCandidatesResponse {
  candidates: {
    id: string;
    legal_name: string;
    normalized_key: string | null;
    score: number;
  }[];
  inserted_link_ids: string[];
  skipped_existing_linked: boolean;
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

/** `review_tasks.payload` for `task_type === 'company_dedupe'` (new tasks). */
export interface CompanyDedupeReviewTaskPayload {
  candidate_company_ids: string[];
  normalized_key?: string;
}

const DEDUPE_PAYLOAD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ParsedCompanyDedupePayload =
  | { status: 'ready'; candidateIds: string[]; normalizedKey: string | null }
  | { status: 'needs_fetch_by_key'; normalizedKey: string }
  | { status: 'needs_company_hint'; companyId: string }
  | { status: 'invalid' };

/**
 * Interpret company_dedupe task payload for the Dedupe UI.
 * New tasks use candidate_company_ids + optional normalized_key.
 * Legacy rows may only have normalized_key or company_id.
 */
export function parseCompanyDedupeTaskPayload(
  payload: Record<string, unknown> | null | undefined,
): ParsedCompanyDedupePayload {
  if (!payload) return { status: 'invalid' };
  const raw = payload.candidate_company_ids;
  if (Array.isArray(raw)) {
    const ids = [
      ...new Set(
        raw.filter((x): x is string => typeof x === 'string' && DEDUPE_PAYLOAD_UUID_RE.test(x)),
      ),
    ];
    if (ids.length >= 2) {
      const normalizedKey = typeof payload.normalized_key === 'string' ? payload.normalized_key : null;
      return { status: 'ready', candidateIds: ids, normalizedKey };
    }
  }
  const nk = payload.normalized_key;
  if (typeof nk === 'string' && nk.length > 0) {
    return { status: 'needs_fetch_by_key', normalizedKey: nk };
  }
  const cid = payload.company_id;
  if (typeof cid === 'string' && DEDUPE_PAYLOAD_UUID_RE.test(cid)) {
    return { status: 'needs_company_hint', companyId: cid };
  }
  return { status: 'invalid' };
}

export type ParsedEntityOwnerDedupePayload =
  | {
      status: 'ready';
      candidateIds: string[];
      stateEntityId: string | null;
      ownerNormalizedKey: string | null;
    }
  | { status: 'needs_cluster_fetch'; stateEntityId: string; ownerNormalizedKey: string }
  | { status: 'invalid' };

/** Interpret entity_owner_dedupe task payload for the Dedupe UI. */
export function parseEntityOwnerDedupeTaskPayload(
  payload: Record<string, unknown> | null | undefined,
): ParsedEntityOwnerDedupePayload {
  if (!payload) return { status: 'invalid' };
  const raw = payload.candidate_entity_owner_ids;
  if (Array.isArray(raw)) {
    const ids = [
      ...new Set(
        raw.filter((x): x is string => typeof x === 'string' && DEDUPE_PAYLOAD_UUID_RE.test(x)),
      ),
    ];
    if (ids.length >= 2) {
      const se =
        typeof payload.state_entity_id === 'string' && DEDUPE_PAYLOAD_UUID_RE.test(payload.state_entity_id)
          ? payload.state_entity_id
          : null;
      const onk = typeof payload.owner_normalized_key === 'string' ? payload.owner_normalized_key : null;
      return { status: 'ready', candidateIds: ids, stateEntityId: se, ownerNormalizedKey: onk };
    }
  }
  const se = payload.state_entity_id;
  const onk = payload.owner_normalized_key;
  if (typeof se === 'string' && DEDUPE_PAYLOAD_UUID_RE.test(se) && typeof onk === 'string' && onk.length > 0) {
    return { status: 'needs_cluster_fetch', stateEntityId: se, ownerNormalizedKey: onk };
  }
  return { status: 'invalid' };
}

export interface ReviewTasksListResponse {
  tasks: ReviewTaskRow[];
}

export interface StateMatchingAutomationBuckets {
  utah_company_ids: string[];
  florida_company_ids: string[];
  unsupported: { company_id: string; state: string }[];
}

export interface StateMatchingPreflightResponse {
  ready: string[];
  missing_state: string[];
  already_matched: string[];
  not_linked: string[];
  /** Present when returned from POST /state-matching/preflight (registry API). */
  automation_buckets?: StateMatchingAutomationBuckets;
}

/** Canonical company row as returned by GET /companies/:id (after parse). */
export interface RegistryCompanyDetailRow {
  id: string;
  legal_name: string;
  normalized_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyLocationRow {
  id: string;
  company_id: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  normalized_address_key: string | null;
  latitude: number | null;
  longitude: number | null;
  source_type: string | null;
  address_confidence: string | null;
  deliverability_status: string | null;
  address_hash: string | null;
}

export interface CompanySourceLinkRow {
  id: string;
  source_business_record_id: string;
  link_status: string;
  link_score: number | null;
  is_current: boolean;
  created_at: string;
}

export interface CompanyEntityMatchRow {
  id: string;
  state_entity_id: string;
  match_status: string;
  match_score: number | null;
  registry_state: string;
  is_current: boolean;
}

/** Normalized company detail for Foundry UI (defensive parse from API JSON). */
export interface ParsedCompanyDetail {
  company: RegistryCompanyDetailRow | null;
  locations: CompanyLocationRow[];
  source_links: CompanySourceLinkRow[];
  entity_matches: CompanyEntityMatchRow[];
}

/** @deprecated Use ParsedCompanyDetail — kept for any external references. */
export type CompanyDetailResponse = ParsedCompanyDetail;

function parseString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function parseNullableString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

function parseBool(v: unknown, defaultVal = false): boolean {
  return typeof v === 'boolean' ? v : defaultVal;
}

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function parseCompanyRow(o: unknown): RegistryCompanyDetailRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  if (!id) return null;
  return {
    id,
    legal_name: parseString(r.legal_name),
    normalized_key: r.normalized_key == null ? null : parseNullableString(r.normalized_key),
    notes: r.notes == null ? null : parseNullableString(r.notes),
    created_at: parseString(r.created_at),
    updated_at: parseString(r.updated_at),
  };
}

function parseLocationRow(o: unknown): CompanyLocationRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  if (!id) return null;
  return {
    id,
    company_id: parseString(r.company_id),
    line1: r.line1 == null ? null : parseNullableString(r.line1),
    line2: r.line2 == null ? null : parseNullableString(r.line2),
    city: r.city == null ? null : parseNullableString(r.city),
    state_region: r.state_region == null ? null : parseNullableString(r.state_region),
    postal_code: r.postal_code == null ? null : parseNullableString(r.postal_code),
    country: r.country == null ? null : parseNullableString(r.country),
    is_primary: parseBool(r.is_primary),
    created_at: parseString(r.created_at),
    updated_at: parseString(r.updated_at),
    normalized_address_key:
      r.normalized_address_key == null ? null : parseNullableString(r.normalized_address_key),
    latitude: parseNumber(r.latitude),
    longitude: parseNumber(r.longitude),
    source_type: r.source_type == null ? null : parseNullableString(r.source_type),
    address_confidence: r.address_confidence == null ? null : parseNullableString(r.address_confidence),
    deliverability_status:
      r.deliverability_status == null ? null : parseNullableString(r.deliverability_status),
    address_hash: r.address_hash == null ? null : parseNullableString(r.address_hash),
  };
}

function parseSourceLinkRow(o: unknown): CompanySourceLinkRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  const source_business_record_id = parseString(r.source_business_record_id);
  if (!id || !source_business_record_id) return null;
  return {
    id,
    source_business_record_id,
    link_status: parseString(r.link_status),
    link_score: parseNumber(r.link_score),
    is_current: parseBool(r.is_current),
    created_at: parseString(r.created_at),
  };
}

function parseEntityMatchRow(o: unknown): CompanyEntityMatchRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  const state_entity_id = parseString(r.state_entity_id);
  if (!id || !state_entity_id) return null;
  return {
    id,
    state_entity_id,
    match_status: parseString(r.match_status),
    match_score: parseNumber(r.match_score),
    registry_state: parseString(r.registry_state),
    is_current: parseBool(r.is_current),
  };
}

export function parseCompanyDetailResponse(raw: unknown): ParsedCompanyDetail {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const locationsRaw = o.locations;
  const linksRaw = o.source_links;
  const matchesRaw = o.entity_matches;

  return {
    company: parseCompanyRow(o.company),
    locations: Array.isArray(locationsRaw)
      ? (locationsRaw.map(parseLocationRow).filter(Boolean) as CompanyLocationRow[])
      : [],
    source_links: Array.isArray(linksRaw)
      ? (linksRaw.map(parseSourceLinkRow).filter(Boolean) as CompanySourceLinkRow[])
      : [],
    entity_matches: Array.isArray(matchesRaw)
      ? (matchesRaw.map(parseEntityMatchRow).filter(Boolean) as CompanyEntityMatchRow[])
      : [],
  };
}

/** Row from view `export_company_owner_leads` (Foundry Export). */
export interface ExportCompanyOwnerLeadRow {
  company_id: string;
  legal_name: string;
  normalized_key: string | null;
  company_updated_at: string;
  company_notes: string | null;
  has_current_linked_source: boolean;
  linked_source_count: number | null;
  company_entity_match_id: string;
  registry_state: string;
  match_status: string;
  match_score: number | string | null;
  match_updated_at: string;
  state_entity_id: string;
  registry_entity_id: string | null;
  state_entity_state: string;
  state_entity_legal_name: string | null;
  entity_owner_id: string | null;
  owner_name: string | null;
  title_role: string | null;
  effective_at: string | null;
  ended_at: string | null;
  observed_at: string | null;
  owner_source_snapshot_id: string | null;
  entity_source_snapshot_id: string | null;
  provenance_snapshot_id: string | null;
  parser_version: string | null;
  primary_location_city: string | null;
  primary_location_state: string | null;
  has_current_owner: boolean;
  has_promoted_match: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
}

export interface ExportCompanyOwnerLeadsResponse {
  rows: ExportCompanyOwnerLeadRow[];
  limit: number;
  offset: number;
  total_count: number;
}

/** Mirrors registry-server `CompanyDeleteImpact`. */
export interface CompanyDeleteImpact {
  company_id: string;
  current_linked_source_count: number;
  current_candidate_or_rejected_link_count: number;
  current_promoted_match_count: number;
  current_other_match_count: number;
  location_count: number;
  sample_linked_source_record_ids: string[];
  sample_match_ids: string[];
  sample_location_ids: string[];
}

export interface CompanyDeletePreflightResponse {
  impact: CompanyDeleteImpact;
  safe: boolean;
  confirmation_token: string;
}

export interface SourceRecordDeleteImpact {
  source_business_record_id: string;
  current_link_count: number;
  sample_link_ids: string[];
}

export interface SourceRecordDeletePreflightResponse {
  impact: SourceRecordDeleteImpact;
  safe: boolean;
  confirmation_token: string;
}

/** Mirrors registry-server `EntityOwnerDeleteImpact`. */
export interface EntityOwnerDeleteImpact {
  entity_owner_id: string;
  history_count: number;
}

export interface EntityOwnerDeletePreflightResponse {
  impact: EntityOwnerDeleteImpact;
  safe: boolean;
  confirmation_token: string;
}

export interface SourceBusinessRecordListRow {
  id: string;
  ingestion_run_id: string;
  source_name: string;
  name_raw: string;
  website: string | null;
  address_raw: string | null;
  observed_at: string;
  created_at: string;
  resolution_meta?: Record<string, unknown> | null;
}

export interface SourceRecordsListResponse {
  records: SourceBusinessRecordListRow[];
  limit: number;
  offset: number;
  total_count: number;
}

export interface CompanyMergeResponse {
  ok: true;
  merge_log: Record<string, unknown>[];
}

export interface EntityOwnerMergeResponse {
  ok: true;
  merge_log: Record<string, unknown>[];
}

export interface SourceRecordsMergeResponse {
  ok: true;
  merge_log: Record<string, unknown>[];
}
