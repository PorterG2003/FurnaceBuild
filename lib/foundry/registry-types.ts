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
  'contact_enrichment_review',
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
  'autolink_ingestion_run',
  'contact_enrichment_import_run',
  'bulk_source_resolution',
  'state_matching_batch',
  'website_verification_import_run',
] as const;
export type FoundryJobType = (typeof FOUNDRY_JOB_TYPES)[number];

export const WEBSITE_VERIFICATION_BANDS = ['usable', 'uncertain', 'not_usable'] as const;
export type WebsiteVerificationBand = (typeof WEBSITE_VERIFICATION_BANDS)[number];

/** Optional progress JSON on foundry_jobs (UI / workers). */
export interface FoundryJobProgress {
  total?: number;
  total_rows?: number;
  total_targets?: number;
  processed?: number;
  rows_processed?: number;
  targets_processed?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  normalized_done?: number;
  normalized_pending?: number;
  outcome_linked?: number;
  outcome_needs_review?: number;
  outcome_failed?: number;
  outcome_skipped?: number;
  outcome_accepted?: number;
  outcome_accepted_by_ruleset?: number;
  outcome_ambiguous?: number;
  outcome_ambiguous_reviewable?: number;
  outcome_ambiguous_low_signal?: number;
  outcome_no_match?: number;
  outcome_error?: number;
  outcome_skipped_recent?: number;
  outcome_usable?: number;
  outcome_uncertain?: number;
  outcome_not_usable?: number;
  in_scope_total?: number;
  not_applicable_count?: number;
  companies_processed?: number;
  companies_with_result?: number;
  reconciliation_outcomes?: Partial<Record<ReconciliationOutcome, number>>;
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

export interface PostStartAutolinkJobResponse {
  jobId: string;
  executionArn: string;
  reused?: boolean;
}

export interface ContactEnrichmentPreflightCounts {
  linked_companies: number;
  candidate_owner_rows: number;
  eligible: number;
  skipped_recent_lookup: number;
  skipped_missing_person_name: number;
  skipped_missing_address: number;
  skipped_no_current_owner: number;
  skipped_already_running: number;
  skipped_suppressed: number;
  skipped_not_ready: number;
}

export type ContactEnrichmentRulesetPreset = 'conservative' | 'balanced' | 'aggressive';

export interface ContactEnrichmentPreflightOptions {
  freshness_window_days?: number;
  force_rerun_recent?: boolean;
  strong_targets_only?: boolean;
  ruleset_preset?: ContactEnrichmentRulesetPreset;
  queue_ambiguous_for_review?: boolean;
  /** Cents per Skip Sherpa hit (billed when person data is returned); omit to use active rate card. */
  cost_per_lookup_cents?: number;
}

export interface ContactEnrichmentPreflightResponse {
  ingestion_run_id: string;
  source_name: string;
  active_job_id: string | null;
  options: {
    freshness_window_days: number;
    force_rerun_recent: boolean;
    strong_targets_only: boolean;
    /** Present once API is deployed with ambiguity system; UI defaults to balanced / false. */
    ruleset_preset?: ContactEnrichmentRulesetPreset;
    queue_ambiguous_for_review?: boolean;
  };
  counts: ContactEnrichmentPreflightCounts;
}

export interface PostStartContactEnrichmentJobResponse {
  jobId: string;
  executionArn: string;
  reused?: boolean;
  preflight: ContactEnrichmentPreflightResponse;
}

export interface WebsiteVerificationPreflightResponse {
  ready: string[];
  missing_website: string[];
}

export interface PostStartWebsiteVerificationJobResponse {
  jobId: string;
  executionArn: string;
  reused?: boolean;
  preflight: WebsiteVerificationPreflightResponse;
}

export interface IngestionRunPipelineJobsResponse {
  ingestion_run_id: string;
  total_source_rows: number;
  normalize_job: FoundryJobRow | null;
  autolink_job: FoundryJobRow | null;
  contact_enrichment_job: FoundryJobRow | null;
  state_matching_job: FoundryJobRow | null;
  website_verification_job: FoundryJobRow | null;
  state_matching_outcome_counts?: Partial<Record<ReconciliationOutcome, number>> | null;
  website_verification_outcome_counts?:
    | (Partial<Record<WebsiteVerificationBand, number>> & { error?: number; skipped?: number })
    | null;
  queue_pending_tasks: number | null;
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

export interface ManualCompaniesListResponse {
  companies: RegistryCompany[];
  limit: number;
  offset: number;
  total_count: number;
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

export interface ManualEntityOwnersListResponse {
  entity_owners: RegistryEntityOwnerRow[];
  limit: number;
  offset: number;
  total_count: number;
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
  total_cost_cents?: number | null;
  cost_per_row_cents?: number | null;
  cost_rate_card_id?: string | null;
  cost_is_override?: boolean;
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
  limit: number;
  offset: number;
  total_count: number;
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
  total_count: number;
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
  /** Cents per successfully imported row; omit to use active rate card for this source. */
  costPerRowCents?: number;
}

/** Active rate from GET /cost-rate-cards?cost_kind&provider&product */
export interface CostRateCardCurrentResponse {
  rate: { id: string; unitPriceCents: number } | null;
}

export interface CostRateCardRow {
  id: string;
  cost_kind: string;
  provider: string;
  product: string;
  unit_price_cents: number;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
}

export interface CostRateCardsListResponse {
  rates: CostRateCardRow[];
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
  companiesById: Record<string, SourceRecordDetailCompanyRow>;
}

export interface SourceRecordDetailCompanyRow {
  id: string;
  legal_name: string;
  normalized_key: string | null;
  primary_address_line: string | null;
  linked_source_websites: string[];
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
  /** From linked source_business_records.website when returned by company detail API. */
  website: string | null;
}

export interface CompanyEntityMatchRow {
  id: string;
  state_entity_id: string;
  match_status: string;
  match_score: number | null;
  registry_state: string;
  is_current: boolean;
}

export interface CompanyWebsiteVerificationPageSignal {
  url: string;
  depth: number;
  title_snippet: string | null;
  parse_ok: boolean;
  json_ld_types: string[];
  sameAs_count?: number;
  mailto_domain_matches_seed?: boolean | null;
  footer_copyright_hit?: boolean | null;
}

export interface CompanyWebsiteVerificationRow {
  id: string;
  company_id: string;
  foundry_job_id: string | null;
  source_ingestion_run_id: string | null;
  input_url: string;
  final_url: string | null;
  score: number | null;
  band: WebsiteVerificationBand | null;
  signals: Record<string, unknown> & { pages?: CompanyWebsiteVerificationPageSignal[] };
  error: string | null;
  verifier_version: string;
  crawl_stats: Record<string, unknown>;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

/** Registry officer/owner row linked to the company via a current entity match. */
export interface CompanyAssociatedPersonRow {
  id: string;
  state_entity_id: string;
  registry_state: string | null;
  owner_name: string;
  title_role: string | null;
  effective_at: string | null;
  ended_at: string | null;
  observed_at: string;
  is_current: boolean;
  first_name: string | null;
  last_name: string | null;
  owner_normalized_key: string | null;
}

export interface CompanyOwnershipChainPersonStep {
  kind: 'person';
  owner_row_id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  title_role: string | null;
}

export interface CompanyOwnershipChainEntityStep {
  kind: 'entity';
  owner_row_id: string | null;
  state_entity_id: string;
  registry_entity_id: string | null;
  legal_name: string | null;
  title_role: string | null;
  registry_state: string | null;
  is_target?: boolean;
}

export type CompanyOwnershipChainStep =
  | CompanyOwnershipChainPersonStep
  | CompanyOwnershipChainEntityStep;

export interface CompanyOwnershipChain {
  depth: number;
  steps: CompanyOwnershipChainStep[];
}

export interface CompanyOwnershipChainTarget {
  company_entity_match_id: string;
  registry_state: string;
  state_entity_id: string;
  registry_entity_id: string | null;
  legal_name: string | null;
  chains: CompanyOwnershipChain[];
}

export interface CompanyOwnershipChainsResponse {
  company_id: string;
  max_depth: number;
  targets: CompanyOwnershipChainTarget[];
}

/** Normalized company detail for Foundry UI (defensive parse from API JSON). */
export interface ParsedCompanyDetail {
  company: RegistryCompanyDetailRow | null;
  locations: CompanyLocationRow[];
  source_links: CompanySourceLinkRow[];
  entity_matches: CompanyEntityMatchRow[];
  associated_people: CompanyAssociatedPersonRow[];
  website_verification: CompanyWebsiteVerificationRow | null;
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
    website: (() => {
      if (r.website == null) return null;
      const s = parseNullableString(r.website);
      const t = s?.trim() ?? '';
      return t.length > 0 ? t : null;
    })(),
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

function parseWebsiteVerificationPageSignal(o: unknown): CompanyWebsiteVerificationPageSignal | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const url = parseString(r.url);
  if (!url) return null;
  return {
    url,
    depth: parseNumber(r.depth) ?? 0,
    title_snippet: r.title_snippet == null ? null : parseNullableString(r.title_snippet),
    parse_ok: parseBool(r.parse_ok),
    json_ld_types: Array.isArray(r.json_ld_types)
      ? r.json_ld_types.map((item) => parseString(item)).filter(Boolean)
      : [],
    sameAs_count: parseNumber(r.sameAs_count) ?? undefined,
    mailto_domain_matches_seed:
      typeof r.mailto_domain_matches_seed === 'boolean' ? r.mailto_domain_matches_seed : null,
    footer_copyright_hit: typeof r.footer_copyright_hit === 'boolean' ? r.footer_copyright_hit : null,
  };
}

function parseWebsiteVerificationRow(o: unknown): CompanyWebsiteVerificationRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  const company_id = parseString(r.company_id);
  const input_url = parseString(r.input_url);
  const verifier_version = parseString(r.verifier_version);
  const verified_at = parseString(r.verified_at);
  const created_at = parseString(r.created_at);
  const updated_at = parseString(r.updated_at);
  if (!id || !company_id || !input_url || !verifier_version || !verified_at || !created_at || !updated_at) {
    return null;
  }
  const signalsRaw = r.signals && typeof r.signals === 'object' ? (r.signals as Record<string, unknown>) : {};
  const pagesRaw = signalsRaw.pages;
  return {
    id,
    company_id,
    foundry_job_id: r.foundry_job_id == null ? null : parseNullableString(r.foundry_job_id),
    source_ingestion_run_id:
      r.source_ingestion_run_id == null ? null : parseNullableString(r.source_ingestion_run_id),
    input_url,
    final_url: r.final_url == null ? null : parseNullableString(r.final_url),
    score: parseNumber(r.score),
    band:
      r.band == null
        ? null
        : WEBSITE_VERIFICATION_BANDS.includes(parseString(r.band) as WebsiteVerificationBand)
          ? (parseString(r.band) as WebsiteVerificationBand)
          : null,
    signals: {
      ...signalsRaw,
      pages: Array.isArray(pagesRaw)
        ? (pagesRaw.map(parseWebsiteVerificationPageSignal).filter(Boolean) as CompanyWebsiteVerificationPageSignal[])
        : [],
    },
    error: r.error == null ? null : parseNullableString(r.error),
    verifier_version,
    crawl_stats: r.crawl_stats && typeof r.crawl_stats === 'object' ? (r.crawl_stats as Record<string, unknown>) : {},
    verified_at,
    created_at,
    updated_at,
  };
}

function parseAssociatedPersonRow(o: unknown): CompanyAssociatedPersonRow | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = parseString(r.id);
  const state_entity_id = parseString(r.state_entity_id);
  const owner_name = parseString(r.owner_name);
  if (!id || !state_entity_id || !owner_name) return null;
  return {
    id,
    state_entity_id,
    registry_state: r.registry_state == null ? null : parseNullableString(r.registry_state),
    owner_name,
    title_role: r.title_role == null ? null : parseNullableString(r.title_role),
    effective_at: r.effective_at == null ? null : parseNullableString(r.effective_at),
    ended_at: r.ended_at == null ? null : parseNullableString(r.ended_at),
    observed_at: parseString(r.observed_at),
    is_current: parseBool(r.is_current, true),
    first_name: r.first_name == null ? null : parseNullableString(r.first_name),
    last_name: r.last_name == null ? null : parseNullableString(r.last_name),
    owner_normalized_key:
      r.owner_normalized_key == null ? null : parseNullableString(r.owner_normalized_key),
  };
}

function parseOwnershipChainStep(o: unknown): CompanyOwnershipChainStep | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const kind = parseString(r.kind);
  if (kind === 'person') {
    const owner_row_id = parseString(r.owner_row_id);
    const name = parseString(r.name);
    if (!owner_row_id || !name) return null;
    return {
      kind: 'person',
      owner_row_id,
      name,
      first_name: r.first_name == null ? null : parseNullableString(r.first_name),
      last_name: r.last_name == null ? null : parseNullableString(r.last_name),
      title_role: r.title_role == null ? null : parseNullableString(r.title_role),
    };
  }
  if (kind === 'entity') {
    const state_entity_id = parseString(r.state_entity_id);
    if (!state_entity_id) return null;
    return {
      kind: 'entity',
      owner_row_id: r.owner_row_id == null ? null : parseNullableString(r.owner_row_id),
      state_entity_id,
      registry_entity_id: r.registry_entity_id == null ? null : parseNullableString(r.registry_entity_id),
      legal_name: r.legal_name == null ? null : parseNullableString(r.legal_name),
      title_role: r.title_role == null ? null : parseNullableString(r.title_role),
      registry_state: r.registry_state == null ? null : parseNullableString(r.registry_state),
      is_target: parseBool(r.is_target, false),
    };
  }
  return null;
}

function parseOwnershipChain(o: unknown): CompanyOwnershipChain | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const stepsRaw = r.steps;
  return {
    depth: parseNumber(r.depth) ?? 0,
    steps: Array.isArray(stepsRaw)
      ? (stepsRaw.map(parseOwnershipChainStep).filter(Boolean) as CompanyOwnershipChainStep[])
      : [],
  };
}

function parseOwnershipChainTarget(o: unknown): CompanyOwnershipChainTarget | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const company_entity_match_id = parseString(r.company_entity_match_id);
  const state_entity_id = parseString(r.state_entity_id);
  if (!company_entity_match_id || !state_entity_id) return null;
  const chainsRaw = r.chains;
  return {
    company_entity_match_id,
    registry_state: parseString(r.registry_state),
    state_entity_id,
    registry_entity_id: r.registry_entity_id == null ? null : parseNullableString(r.registry_entity_id),
    legal_name: r.legal_name == null ? null : parseNullableString(r.legal_name),
    chains: Array.isArray(chainsRaw)
      ? (chainsRaw.map(parseOwnershipChain).filter(Boolean) as CompanyOwnershipChain[])
      : [],
  };
}

export function parseCompanyDetailResponse(raw: unknown): ParsedCompanyDetail {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const locationsRaw = o.locations;
  const linksRaw = o.source_links;
  const matchesRaw = o.entity_matches;
  const peopleRaw = o.associated_people;
  const websiteVerificationRaw = o.website_verification;

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
    associated_people: Array.isArray(peopleRaw)
      ? (peopleRaw.map(parseAssociatedPersonRow).filter(Boolean) as CompanyAssociatedPersonRow[])
      : [],
    website_verification: parseWebsiteVerificationRow(websiteVerificationRaw),
  };
}

export function parseCompanyOwnershipChainsResponse(raw: unknown): CompanyOwnershipChainsResponse {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const targetsRaw = o.targets;
  return {
    company_id: parseString(o.company_id),
    max_depth: parseNumber(o.max_depth) ?? 0,
    targets: Array.isArray(targetsRaw)
      ? (targetsRaw.map(parseOwnershipChainTarget).filter(Boolean) as CompanyOwnershipChainTarget[])
      : [],
  };
}

/** Row from view `export_company_targets` (one row per exportable company target). */
export interface ExportCompanyTargetRow {
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
  entity_source_snapshot_id: string | null;
  registry_entity_id: string | null;
  state_entity_state: string;
  state_entity_legal_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  primary_location_city: string | null;
  primary_location_state: string | null;
  website: string | null;
  has_current_owner: boolean;
  has_promoted_match: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
}

/** Row from view `export_company_owner_leads` (one row per current owner, or one null-owner row per target). */
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
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  primary_location_city: string | null;
  primary_location_state: string | null;
  website: string | null;
  has_current_owner: boolean;
  has_promoted_match: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
  /** Present when export is requested with `include_contact=true`. */
  contact_email_1?: string | null;
  contact_email_2?: string | null;
  contact_email_3?: string | null;
  contact_phone_1?: string | null;
  contact_phone_1_type?: string | null;
  contact_phone_1_is_dnc?: boolean | null;
  contact_phone_1_dnc_summary?: string | null;
  contact_phone_2?: string | null;
  contact_phone_2_type?: string | null;
  contact_phone_2_is_dnc?: boolean | null;
  contact_phone_2_dnc_summary?: string | null;
  contact_phone_3?: string | null;
  contact_phone_3_type?: string | null;
  contact_phone_3_is_dnc?: boolean | null;
  contact_phone_3_dnc_summary?: string | null;
  /** Present when `include_contact_confidence=true`. */
  contact_confidence_tier?: string | null;
  contact_enrichment_top_score?: number | null;
  contact_enrichment_score_margin?: number | null;
  contact_enrichment_reason_summary?: string | null;
  /** Present when `include_cost=true` on export API. Values are USD cents unless you add currency later. */
  enrichment_cost_cents?: number | null;
  company_acquisition_cost_cents?: number | null;
  acquisition_cost_per_row_cents?: number | null;
  total_cost_per_row_cents?: number | null;
}

export interface ExportCompanyOwnerLeadsResponse {
  rows: ExportCompanyOwnerLeadRow[];
  limit: number;
  offset: number;
  /** Count of matching owner rows, not distinct companies/targets. */
  total_count: number;
}

/** Flattened chain export row; each row is a terminal person reached from one company target. */
export interface ExportCompanyChainPeopleRow {
  company_id: string;
  company_legal_name: string;
  company_entity_match_id: string;
  registry_state: string;
  state_entity_id: string;
  registry_entity_id: string | null;
  state_entity_legal_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  website: string | null;
  has_current_linked_source: boolean;
  has_current_owner: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
  person_owner_row_id: string;
  person_name: string;
  person_first_name: string | null;
  person_last_name: string | null;
  person_title_role: string | null;
  chain_depth: number;
  linkage_path: string;
  /** Present when export is requested with `include_contact=true`. */
  contact_email_1?: string | null;
  contact_email_2?: string | null;
  contact_email_3?: string | null;
  contact_phone_1?: string | null;
  contact_phone_1_type?: string | null;
  contact_phone_1_is_dnc?: boolean | null;
  contact_phone_1_dnc_summary?: string | null;
  contact_phone_2?: string | null;
  contact_phone_2_type?: string | null;
  contact_phone_2_is_dnc?: boolean | null;
  contact_phone_2_dnc_summary?: string | null;
  contact_phone_3?: string | null;
  contact_phone_3_type?: string | null;
  contact_phone_3_is_dnc?: boolean | null;
  contact_phone_3_dnc_summary?: string | null;
  /** Present when `include_contact_confidence=true`. */
  contact_confidence_tier?: string | null;
  contact_enrichment_top_score?: number | null;
  contact_enrichment_score_margin?: number | null;
  contact_enrichment_reason_summary?: string | null;
  enrichment_cost_cents?: number | null;
  company_acquisition_cost_cents?: number | null;
  acquisition_cost_per_row_cents?: number | null;
  total_cost_per_row_cents?: number | null;
}

export interface ExportCompanyChainPeopleResponse {
  rows: ExportCompanyChainPeopleRow[];
  limit: number;
  offset: number;
  /** Count of matching company targets (not expanded person rows). */
  total_count: number;
  /** Number of company targets included in this page before chain expansion. */
  targets_returned: number;
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
