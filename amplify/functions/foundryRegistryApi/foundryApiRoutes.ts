import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildContactEnrichmentPreflight,
  bulkAutoResolve,
  companyDeleteImpactFingerprint,
  createCsvBuilderColumn,
  createCsvBuilderToolJob,
  createCsvBuilderRun,
  entityOwnerDeleteImpactFingerprint,
  getCsvBuilderColumn,
  getCsvBuilderToolJob,
  getCsvBuilderRun,
  generateCandidatesForSourceRecord,
  getSourceRecordDetail,
  isCompanyDeleteSafe,
  isEntityOwnerDeleteSafe,
  isSourceRecordDeleteSafe,
  listCsvBuilderColumns,
  listCsvBuilderRows,
  listCsvBuilderRuns,
  listCsvBuilderToolJobs,
  linkSourceToCompany,
  loadCompanyDeleteImpact,
  loadEntityOwnerDeleteImpact,
  loadSourceRecordDeleteImpact,
  mergeCompanies,
  mergeEntityOwners,
  mergeSourceBusinessRecords,
  normalizeIngestionRunRecords,
  rejectCandidatesForSource,
  rerunCsvBuilderColumn,
  rerunCsvBuilderToolJob,
  lookupCurrentRate,
  resolveContactEnrichmentOptions,
} from '@furnace/registry-server';
import {
  bucketCompaniesForMatching,
  getReviewTask,
  listReviewTasks,
  resolveReviewTask,
  stateMatchingPreflight,
} from './foundryLayer2.js';
import { startCsvBuilderExportJob, startCsvBuilderToolJob } from './foundryJobsApi.js';
import type {
  CsvBuilderCellValue,
  CsvBuilderFilter,
  CsvBuilderToolJobConfig,
} from '../../../lib/foundry/registry-types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FunctionUrlResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

function jsonResponse(statusCode: number, data: object): FunctionUrlResponse {
  return {
    statusCode,
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  };
}

function parseLimit(q: string, max: number, def: number): number {
  const params = new URLSearchParams(q || '');
  const raw = params.get('limit');
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

function parseOffsetExport(q: string): number {
  const params = new URLSearchParams(q || '');
  const raw = params.get('offset');
  if (raw == null || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Escape % and _ for ILIKE patterns. */
function escapeIlikePatternExport(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function parseTriStateBoolParam(params: URLSearchParams, key: string): boolean | undefined {
  const v = params.get(key);
  if (v === null || v === '') return undefined;
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return undefined;
}

function parseSortDirectionParam(params: URLSearchParams): 'asc' | 'desc' {
  return params.get('sort_direction') === 'asc' ? 'asc' : 'desc';
}

function parseJsonParam<T>(params: URLSearchParams, key: string, fallback: T): T {
  const raw = params.get(key);
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isCsvBuilderColumnDataType(
  value: unknown,
): value is 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' {
  return (
    value === 'text' ||
    value === 'number' ||
    value === 'boolean' ||
    value === 'date' ||
    value === 'datetime' ||
    value === 'json'
  );
}

function isCsvBuilderToolType(
  value: unknown,
): value is 'website_verification' | 'google_ads_verification' | 'state_matching' | 'contact_enrichment' {
  return (
    value === 'website_verification' ||
    value === 'google_ads_verification' ||
    value === 'state_matching' ||
    value === 'contact_enrichment'
  );
}

function isCsvBuilderFilterOperator(
  value: unknown,
): value is 'contains' | 'equals' | 'empty' | 'not_empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after' {
  return (
    value === 'contains' ||
    value === 'equals' ||
    value === 'empty' ||
    value === 'not_empty' ||
    value === 'gt' ||
    value === 'gte' ||
    value === 'lt' ||
    value === 'lte' ||
    value === 'before' ||
    value === 'after'
  );
}

function coerceCsvBuilderCellValue(value: unknown): CsvBuilderCellValue {
  if (value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value as Record<string, unknown>;
  return String(value);
}

async function assertAccountMembership(
  mainClient: SupabaseClient,
  actorUserId: string,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await mainClient
    .from('account_users')
    .select('id')
    .eq('user_id', actorUserId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

const MAX_EXPORT_LEADS_LIMIT = 100;
const DEFAULT_EXPORT_LEADS_LIMIT = 50;

const CONTACT_ENRICHMENT_CONFIDENCE_KEYS = [
  'contact_confidence_tier',
  'contact_enrichment_top_score',
  'contact_enrichment_score_margin',
  'contact_enrichment_reason_summary',
] as const;

const EXPORT_COST_KEYS = [
  'enrichment_cost_cents',
  'company_enrichment_cost_cents',
  'enrichment_cost_per_row_cents',
  'company_acquisition_cost_cents',
  'acquisition_cost_per_row_cents',
  'total_cost_per_row_cents',
  'company_export_row_count',
  'company_website_verification_cost_cents',
  'company_google_ads_verification_cost_cents',
  'company_import_acquisition_cost_cents',
  'company_registry_acquisition_cost_cents',
] as const;

function stripCostFields(row: Record<string, unknown>): void {
  for (const k of EXPORT_COST_KEYS) {
    delete row[k];
  }
}

function parseIncludeCostFlag(params: URLSearchParams): boolean {
  return params.get('include_cost') === 'true' || params.get('include_cost') === '1';
}

function parseIncludeGoogleAdsVerificationFlag(params: URLSearchParams): boolean {
  return (
    params.get('include_google_ads_verification') === 'true' ||
    params.get('include_google_ads_verification') === '1'
  );
}

function parseIncludeContactFlags(params: URLSearchParams): {
  includeContact: boolean;
  includeContactConfidence: boolean;
} {
  const includeContact =
    params.get('include_contact') === 'true' || params.get('include_contact') === '1';
  const includeContactConfidence =
    includeContact &&
    (params.get('include_contact_confidence') === 'true' ||
      params.get('include_contact_confidence') === '1');
  return { includeContact, includeContactConfidence };
}

function stripContactConfidenceFields(row: Record<string, unknown>): void {
  for (const k of CONTACT_ENRICHMENT_CONFIDENCE_KEYS) {
    delete row[k];
  }
}

async function loadOwnerContactEnrichmentFlatMap(
  leadsClient: SupabaseClient,
  pairs: Array<{ company_id: string; entity_owner_id: string }>,
  includeConfidence: boolean,
): Promise<Map<string, Record<string, unknown>>> {
  const wanted = new Set(pairs.map((p) => `${p.company_id}:${p.entity_owner_id}`));
  const companyIds = [...new Set(pairs.map((p) => p.company_id))];
  if (companyIds.length === 0) return new Map();

  const { data, error } = await leadsClient.from('export_owner_contact_enrichment_flat').select('*').in('company_id', companyIds);

  if (error) throw new Error(error.message);

  const map = new Map<string, Record<string, unknown>>();
  for (const raw of data ?? []) {
    const row = { ...(raw as Record<string, unknown>) };
    if (!includeConfidence) stripContactConfidenceFields(row);
    const cid = row.company_id;
    const eid = row.entity_owner_id;
    if (typeof cid !== 'string' || typeof eid !== 'string') continue;
    const key = `${cid}:${eid}`;
    if (!wanted.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

const EXPORT_CONTACT_VALUE_KEYS = [
  'contact_email_1',
  'contact_email_2',
  'contact_email_3',
  'contact_phone_1',
  'contact_phone_1_type',
  'contact_phone_1_is_dnc',
  'contact_phone_1_dnc_summary',
  'contact_phone_2',
  'contact_phone_2_type',
  'contact_phone_2_is_dnc',
  'contact_phone_2_dnc_summary',
  'contact_phone_3',
  'contact_phone_3_type',
  'contact_phone_3_is_dnc',
  'contact_phone_3_dnc_summary',
] as const;

function applyContactFlatToRow(
  target: Record<string, unknown>,
  flat: Record<string, unknown> | undefined,
  includeConfidence: boolean,
): void {
  if (!flat) return;
  for (const k of EXPORT_CONTACT_VALUE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(flat, k)) target[k] = flat[k];
  }
  if (includeConfidence) {
    for (const k of CONTACT_ENRICHMENT_CONFIDENCE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(flat, k)) target[k] = flat[k];
    }
  }
}

async function loadLatestGoogleAdsVerificationByCompanyMap(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await leadsClient
    .from('company_google_ads_verifications')
    .select(
      'company_id, result, search_domain, matched_advertiser_name, advertiser_url, latest_ad_last_shown_at, verified_at, error',
    )
    .in('company_id', companyIds);
  if (error) throw new Error(error.message);
  const best = new Map<string, { t: number; row: Record<string, unknown> }>();
  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    const cid = r.company_id;
    if (typeof cid !== 'string') continue;
    const at = Date.parse(String(r.verified_at ?? ''));
    const t = Number.isFinite(at) ? at : 0;
    const prev = best.get(cid);
    if (!prev || t >= prev.t) best.set(cid, { t, row: r });
  }
  return new Map([...best.entries()].map(([cid, { row }]) => [cid, row]));
}

function applyGoogleAdsVerificationFieldsToExportRow(
  target: Record<string, unknown>,
  v: Record<string, unknown> | undefined,
): void {
  if (!v) {
    target.google_ads_verification_result = null;
    target.google_ads_search_domain = null;
    target.google_ads_matched_advertiser_name = null;
    target.google_ads_advertiser_url = null;
    target.google_ads_verified_at = null;
    target.google_ads_verification_error = null;
    return;
  }
  target.google_ads_verification_result = v.result ?? null;
  target.google_ads_search_domain = v.search_domain ?? null;
  target.google_ads_matched_advertiser_name = v.matched_advertiser_name ?? null;
  target.google_ads_advertiser_url = v.advertiser_url ?? null;
  target.google_ads_latest_ad_last_shown_at = v.latest_ad_last_shown_at ?? null;
  target.google_ads_verified_at = v.verified_at ?? null;
  target.google_ads_verification_error = v.error ?? null;
}

async function mergeGoogleAdsVerificationsIntoExportRows(
  leadsClient: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  const companyIds = [
    ...new Set(rows.map((r) => r.company_id).filter((id): id is string => typeof id === 'string')),
  ];
  const map = await loadLatestGoogleAdsVerificationByCompanyMap(leadsClient, companyIds);
  for (const row of rows) {
    const cid = row.company_id;
    applyGoogleAdsVerificationFieldsToExportRow(row, typeof cid === 'string' ? map.get(cid) : undefined);
  }
}

function parseJsonBody<T>(raw: string): { ok: true; value: T } | { ok: false; response: FunctionUrlResponse } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'Invalid JSON body' }) };
  }
}

function signCompanyDeleteConfirm(companyId: string, fingerprint: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`company_delete_v1\n${companyId}\n${fingerprint}`)
    .digest('base64url');
}

function verifyCompanyDeleteConfirm(companyId: string, fingerprint: string, token: string, secret: string): boolean {
  const expected = signCompanyDeleteConfirm(companyId, fingerprint, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sourceRecordDeleteFingerprint(linkCount: number): string {
  return `links:${linkCount}`;
}

function signSourceRecordDeleteConfirm(recordId: string, fingerprint: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`source_record_delete_v1\n${recordId}\n${fingerprint}`)
    .digest('base64url');
}

function verifySourceRecordDeleteConfirm(recordId: string, fingerprint: string, token: string, secret: string): boolean {
  const expected = signSourceRecordDeleteConfirm(recordId, fingerprint, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function signEntityOwnerDeleteConfirm(entityOwnerId: string, fingerprint: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`entity_owner_delete_v1\n${entityOwnerId}\n${fingerprint}`)
    .digest('base64url');
}

function verifyEntityOwnerDeleteConfirm(entityOwnerId: string, fingerprint: string, token: string, secret: string): boolean {
  const expected = signEntityOwnerDeleteConfirm(entityOwnerId, fingerprint, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const DEFAULT_OWNERSHIP_CHAIN_MAX_DEPTH = 6;
const MAX_OWNERSHIP_CHAIN_DEPTH = 10;
const DEFAULT_OWNERSHIP_CHAIN_LIMIT = 100;
const MAX_OWNERSHIP_CHAIN_LIMIT = 200;

type OwnershipChainStep =
  | {
      kind: 'person';
      owner_row_id: string;
      name: string;
      first_name: string | null;
      last_name: string | null;
      title_role: string | null;
    }
  | {
      kind: 'entity';
      owner_row_id: string | null;
      state_entity_id: string;
      registry_entity_id: string | null;
      legal_name: string | null;
      title_role: string | null;
      registry_state: string | null;
      is_target?: boolean;
    };

type OwnershipChain = {
  depth: number;
  steps: OwnershipChainStep[];
};

type OwnershipChainTarget = {
  company_entity_match_id: string;
  registry_state: string;
  state_entity_id: string;
  registry_entity_id: string | null;
  legal_name: string | null;
  chains: OwnershipChain[];
};

type ExportChainTargetRow = {
  company_id: string;
  company_legal_name: string;
  company_entity_match_id: string;
  registry_state: string;
  company_updated_at: string;
  match_updated_at: string;
  state_entity_id: string;
  registry_entity_id: string | null;
  state_entity_state: string;
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
};

function clampOwnershipChainDepth(raw: string | null): number {
  const n = raw == null || raw === '' ? DEFAULT_OWNERSHIP_CHAIN_MAX_DEPTH : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_OWNERSHIP_CHAIN_MAX_DEPTH;
  return Math.min(MAX_OWNERSHIP_CHAIN_DEPTH, n);
}

function clampOwnershipChainLimit(raw: string | null): number {
  const n = raw == null || raw === '' ? DEFAULT_OWNERSHIP_CHAIN_LIMIT : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_OWNERSHIP_CHAIN_LIMIT;
  return Math.min(MAX_OWNERSHIP_CHAIN_LIMIT, n);
}

function buildExportCompanyOwnerLeadsQuery(
  leadsClient: SupabaseClient,
  params: URLSearchParams,
  options?: { withCount?: boolean },
) {
  const { includeContact } = parseIncludeContactFlags(params);
  const includeCost = parseIncludeCostFlag(params);
  const table = includeContact
    ? 'export_company_owner_leads_with_contacts'
    : includeCost
      ? 'export_company_owner_leads_with_cost'
      : 'export_company_owner_leads';
  const selectOptions = options?.withCount ? { count: 'exact' as const } : undefined;
  let qb = selectOptions
    ? leadsClient.from(table).select('*', selectOptions)
    : leadsClient.from(table).select('*');
  qb = applyExportQueryFilters(qb, params);

  return qb
    .order('company_updated_at', { ascending: false })
    .order('match_updated_at', { ascending: false })
    .order('entity_owner_id', { ascending: true, nullsFirst: false });
}

function buildExportCompanyTargetsQuery(
  leadsClient: SupabaseClient,
  params: URLSearchParams,
  selectClause: string,
  options?: { withCount?: boolean },
) {
  const selectOptions = options?.withCount ? { count: 'exact' as const } : undefined;
  let qb = selectOptions
    ? leadsClient.from('export_company_targets').select(selectClause, selectOptions)
    : leadsClient.from('export_company_targets').select(selectClause);
  qb = applyExportQueryFilters(qb, params);
  return qb
    .order('company_updated_at', { ascending: false })
    .order('match_updated_at', { ascending: false })
    .order('company_entity_match_id', { ascending: true });
}

function applyExportQueryFilters(qb: any, params: URLSearchParams) {
  const qSearch = params.get('q')?.trim() ?? '';
  const registryState = params.get('registry_state')?.trim();

  if (qSearch.length >= 2) {
    qb = qb.ilike('legal_name', `%${escapeIlikePatternExport(qSearch)}%`);
  }
  if (registryState) {
    qb = qb.eq('registry_state', registryState.toUpperCase());
  }

  const isExportReady = parseTriStateBoolParam(params, 'is_export_ready');
  if (isExportReady !== undefined) qb = qb.eq('is_export_ready', isExportReady);

  const hasLinked = parseTriStateBoolParam(params, 'has_current_linked_source');
  if (hasLinked !== undefined) qb = qb.eq('has_current_linked_source', hasLinked);

  const hasOpenReview = parseTriStateBoolParam(params, 'has_open_review_task');
  if (hasOpenReview !== undefined) qb = qb.eq('has_open_review_task', hasOpenReview);

  const hasParseFailure = parseTriStateBoolParam(params, 'has_parse_failure_task');
  if (hasParseFailure !== undefined) qb = qb.eq('has_parse_failure_task', hasParseFailure);

  const hasCurrentOwner = parseTriStateBoolParam(params, 'has_current_owner');
  if (hasCurrentOwner !== undefined) qb = qb.eq('has_current_owner', hasCurrentOwner);

  return qb;
}

function readNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

function formatOwnershipChainStepLabel(step: OwnershipChainStep): string {
  if (step.kind === 'person') {
    const base = step.name.trim() || [step.first_name, step.last_name].filter(Boolean).join(' ').trim() || step.owner_row_id;
    return step.title_role ? `${base} (${step.title_role})` : base;
  }
  const baseName =
    step.legal_name?.trim() ||
    step.registry_entity_id?.trim() ||
    step.state_entity_id;
  const stateSuffix = step.registry_state ? ` (${step.registry_state})` : '';
  const roleSuffix = step.title_role ? ` [${step.title_role}]` : '';
  return `${baseName}${stateSuffix}${roleSuffix}`;
}

function formatOwnershipLinkagePath(chain: OwnershipChain): string {
  return chain.steps.map((step) => formatOwnershipChainStepLabel(step)).join(' <- ');
}

async function listExportChainTargetsPage(
  leadsClient: SupabaseClient,
  params: URLSearchParams,
  limit: number,
  offset: number,
): Promise<{ targets: ExportChainTargetRow[]; total_count: number }> {
  const end = offset + limit - 1;
  const { data, error, count } = await buildExportCompanyTargetsQuery(
    leadsClient,
    params,
    [
      'company_id',
      'legal_name',
      'company_entity_match_id',
      'registry_state',
      'company_updated_at',
      'match_updated_at',
      'state_entity_id',
      'registry_entity_id',
      'state_entity_state',
      'state_entity_legal_name',
      'address_line_1',
      'address_line_2',
      'address_city',
      'address_state',
      'address_postal_code',
      'address_country',
      'website',
      'has_current_linked_source',
      'has_current_owner',
      'has_open_review_task',
      'has_parse_failure_task',
      'is_export_ready',
    ].join(', '),
    { withCount: true },
  ).range(offset, end);
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  return {
    targets: rows.map((row) => ({
      company_id: String(row.company_id ?? ''),
      company_legal_name: String(row.legal_name ?? ''),
      company_entity_match_id: String(row.company_entity_match_id ?? ''),
      registry_state: String(row.registry_state ?? ''),
      company_updated_at: String(row.company_updated_at ?? ''),
      match_updated_at: String(row.match_updated_at ?? ''),
      state_entity_id: String(row.state_entity_id ?? ''),
      registry_entity_id: readNullableString(row.registry_entity_id),
      state_entity_state: String(row.state_entity_state ?? ''),
      state_entity_legal_name: readNullableString(row.state_entity_legal_name),
      address_line_1: readNullableString(row.address_line_1),
      address_line_2: readNullableString(row.address_line_2),
      address_city: readNullableString(row.address_city),
      address_state: readNullableString(row.address_state),
      address_postal_code: readNullableString(row.address_postal_code),
      address_country: readNullableString(row.address_country),
      website: readNullableString(row.website),
      has_current_linked_source: Boolean(row.has_current_linked_source),
      has_current_owner: Boolean(row.has_current_owner),
      has_open_review_task: Boolean(row.has_open_review_task),
      has_parse_failure_task: Boolean(row.has_parse_failure_task),
      is_export_ready: Boolean(row.is_export_ready),
    })),
    total_count: count ?? 0,
  };
}

async function loadOwnershipChainsForTarget(
  leadsClient: SupabaseClient,
  params: {
    targetStateEntityId: string;
    targetRegistryState: string;
    targetRegistryEntityId: string | null;
    targetLegalName: string | null;
    maxDepth: number;
    maxChains: number;
  },
): Promise<OwnershipChain[]> {
  type OwnerRow = {
    id: string;
    state_entity_id: string;
    owner_name: string;
    first_name: string | null;
    last_name: string | null;
    title_role: string | null;
    owner_kind: string | null;
    resolution_status: string | null;
    resolved_state_entity_id: string | null;
    is_current: boolean;
  };

  type EntityRow = {
    id: string;
    state: string;
    registry_entity_id: string | null;
    legal_name: string | null;
  };

  const entityCache = new Map<string, EntityRow>();
  const ownerCache = new Map<string, OwnerRow[]>();
  const chains: OwnershipChain[] = [];

  async function loadEntities(ids: string[]): Promise<void> {
    const missing = [...new Set(ids.filter((id) => id && !entityCache.has(id)))];
    if (missing.length === 0) return;
    const { data, error } = await leadsClient
      .from('state_entities')
      .select('id, state, registry_entity_id, legal_name')
      .in('id', missing);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      entityCache.set(String(row.id), {
        id: String(row.id),
        state: typeof row.state === 'string' ? row.state : '',
        registry_entity_id: row.registry_entity_id == null ? null : String(row.registry_entity_id),
        legal_name: row.legal_name == null ? null : String(row.legal_name),
      });
    }
  }

  async function loadOwners(stateEntityId: string): Promise<OwnerRow[]> {
    if (ownerCache.has(stateEntityId)) return ownerCache.get(stateEntityId) ?? [];
    const { data, error } = await leadsClient
      .from('entity_owners')
      .select(
        'id, state_entity_id, owner_name, first_name, last_name, title_role, owner_kind, resolution_status, resolved_state_entity_id, is_current',
      )
      .eq('state_entity_id', stateEntityId)
      .eq('is_current', true)
      .order('owner_name', { ascending: true });
    if (error) throw new Error(error.message);
    const rows: OwnerRow[] = (data ?? []).map((row) => ({
      id: String(row.id),
      state_entity_id: String(row.state_entity_id),
      owner_name: String(row.owner_name ?? ''),
      first_name: row.first_name == null ? null : String(row.first_name),
      last_name: row.last_name == null ? null : String(row.last_name),
      title_role: row.title_role == null ? null : String(row.title_role),
      owner_kind: row.owner_kind == null ? null : String(row.owner_kind),
      resolution_status: row.resolution_status == null ? null : String(row.resolution_status),
      resolved_state_entity_id:
        row.resolved_state_entity_id == null ? null : String(row.resolved_state_entity_id),
      is_current: Boolean(row.is_current),
    }));
    ownerCache.set(stateEntityId, rows);
    return rows;
  }

  async function walk(
    currentStateEntityId: string,
    depth: number,
    pathSteps: OwnershipChainStep[],
    visitedEntityIds: string[],
  ): Promise<void> {
    if (chains.length >= params.maxChains || depth > params.maxDepth) return;
    const owners = await loadOwners(currentStateEntityId);
    for (const owner of owners) {
      if (chains.length >= params.maxChains) return;
      if (owner.owner_kind === 'person') {
        chains.push({
          depth,
          steps: [
            {
              kind: 'person',
              owner_row_id: owner.id,
              name: owner.owner_name,
              first_name: owner.first_name,
              last_name: owner.last_name,
              title_role: owner.title_role,
            },
            ...pathSteps,
          ],
        });
        continue;
      }

      if (
        owner.owner_kind === 'entity' &&
        owner.resolved_state_entity_id &&
        owner.resolution_status === 'entity_resolved' &&
        !visitedEntityIds.includes(owner.resolved_state_entity_id)
      ) {
        await loadEntities([owner.resolved_state_entity_id]);
        const entity = entityCache.get(owner.resolved_state_entity_id);
        const nextStep: OwnershipChainStep = {
          kind: 'entity',
          owner_row_id: owner.id,
          state_entity_id: owner.resolved_state_entity_id,
          registry_entity_id: entity?.registry_entity_id ?? null,
          legal_name: entity?.legal_name ?? owner.owner_name,
          title_role: owner.title_role,
          registry_state: entity?.state ?? null,
        };
        await walk(
          owner.resolved_state_entity_id,
          depth + 1,
          [nextStep, ...pathSteps],
          [...visitedEntityIds, owner.resolved_state_entity_id],
        );
      }
    }
  }

  const targetStep: OwnershipChainStep = {
    kind: 'entity',
    owner_row_id: null,
    state_entity_id: params.targetStateEntityId,
    registry_entity_id: params.targetRegistryEntityId,
    legal_name: params.targetLegalName,
    title_role: null,
    registry_state: params.targetRegistryState,
    is_target: true,
  };
  await walk(params.targetStateEntityId, 1, [targetStep], [params.targetStateEntityId]);
  return chains;
}

async function loadExportRowCostMap(
  leadsClient: SupabaseClient,
  pairs: Array<{ company_id: string; entity_owner_id: string }>,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (pairs.length === 0) return out;
  const companyIds = [...new Set(pairs.map((p) => p.company_id))];
  const { data, error } = await leadsClient.from('export_row_cost_summary').select('*').in('company_id', companyIds);
  if (error) throw new Error(error.message);
  const wanted = new Set(pairs.map((p) => `${p.company_id}\0${p.entity_owner_id}`));
  for (const row of data ?? []) {
    const rec = row as Record<string, unknown>;
    const cid = String(rec.company_id ?? '');
    const eid = rec.entity_owner_id == null ? '' : String(rec.entity_owner_id);
    const key = `${cid}\0${eid}`;
    if (wanted.has(key)) out.set(key, rec);
  }
  return out;
}

export async function dispatchFoundryExtendedRoutes(
  mainClient: SupabaseClient,
  leadsClient: SupabaseClient,
  method: string,
  path: string,
  rawBody: string,
  rawQueryString: string,
  actorUserId: string,
  hmacSecret: string,
): Promise<FunctionUrlResponse | null> {
  if (path === '/csv-builder/runs' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const accountId = params.get('account_id')?.trim() || '';
    if (!UUID_RE.test(accountId)) return jsonResponse(400, { error: 'account_id is required' });
    try {
      const allowed = await assertAccountMembership(mainClient, actorUserId, accountId);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      const limit = parseLimit(rawQueryString || '', 100, 25);
      const offset = parseOffsetExport(rawQueryString || '');
      const result = await listCsvBuilderRuns(
        leadsClient as unknown as Parameters<typeof listCsvBuilderRuns>[0],
        accountId,
        { limit, offset },
      );
      return jsonResponse(200, result);
    } catch (error) {
      return jsonResponse(502, { error: error instanceof Error ? error.message : 'Failed to load CSV Builder runs' });
    }
  }

  if (path === '/csv-builder/runs' && method === 'POST') {
    const parsed = parseJsonBody<{
      account_id: string;
      name: string;
      source_file_name: string;
      source_file_size_bytes?: number | null;
      source_file_mime_type?: string | null;
      headers: Array<{ key: string; label: string; data_type?: string }>;
      rows: Array<Record<string, unknown>>;
    }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    const accountId = parsed.value.account_id?.trim() || '';
    if (!UUID_RE.test(accountId)) return jsonResponse(400, { error: 'account_id is required' });
    try {
      const allowed = await assertAccountMembership(mainClient, actorUserId, accountId);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      const typedHeaders = parsed.value.headers.map((header) => ({
        key: String(header.key ?? '').trim(),
        label: String(header.label ?? '').trim(),
        data_type: isCsvBuilderColumnDataType(header.data_type) ? header.data_type : undefined,
      }));
      const typedRows: Array<Record<string, CsvBuilderCellValue>> = parsed.value.rows.map((row) => {
        const typedRow: Record<string, CsvBuilderCellValue> = {};
        for (const [key, value] of Object.entries(row ?? {})) {
          typedRow[key] = coerceCsvBuilderCellValue(value);
        }
        return typedRow;
      });
      const result = await createCsvBuilderRun(leadsClient as unknown as Parameters<typeof createCsvBuilderRun>[0], actorUserId, {
        name: parsed.value.name,
        source_file_name: parsed.value.source_file_name,
        source_file_size_bytes: parsed.value.source_file_size_bytes,
        source_file_mime_type: parsed.value.source_file_mime_type,
        headers: typedHeaders,
        rows: typedRows,
        account_id: accountId,
      });
      return jsonResponse(200, result);
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to create CSV Builder run' });
    }
  }

  const csvBuilderRunMatch = path.match(/^\/csv-builder\/runs\/([^/]+)$/);
  if (csvBuilderRunMatch) {
    const runId = csvBuilderRunMatch[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    if (method === 'GET') {
      try {
        const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], runId);
        if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
        const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
        if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
        return jsonResponse(200, { run });
      } catch (error) {
        return jsonResponse(502, { error: error instanceof Error ? error.message : 'Failed to load CSV Builder run' });
      }
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const csvBuilderRunColumnsMatch = path.match(/^\/csv-builder\/runs\/([^/]+)\/columns$/);
  if (csvBuilderRunColumnsMatch) {
    const runId = csvBuilderRunColumnsMatch[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    try {
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], runId);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      if (method === 'GET') {
        const columns = await listCsvBuilderColumns(leadsClient as unknown as Parameters<typeof listCsvBuilderColumns>[0], runId);
        return jsonResponse(200, { columns });
      }
      if (method === 'POST') {
        const parsed = parseJsonBody<{
          label: string;
          tool_type: string;
          input_column_ids: string[];
          tool_config?: Record<string, unknown>;
        }>(rawBody || '{}');
        if (!parsed.ok) return parsed.response;
        if (!isCsvBuilderToolType(parsed.value.tool_type)) {
          return jsonResponse(400, { error: 'Unsupported CSV Builder tool type' });
        }
        const result = await createCsvBuilderColumn(
          leadsClient as unknown as Parameters<typeof createCsvBuilderColumn>[0],
          runId,
          {
            label: parsed.value.label,
            tool_type: parsed.value.tool_type,
            input_column_ids: parsed.value.input_column_ids,
            tool_config: parsed.value.tool_config,
          },
        );
        return jsonResponse(200, result);
      }
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to load CSV Builder columns' });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const csvBuilderRunRowsMatch = path.match(/^\/csv-builder\/runs\/([^/]+)\/rows$/);
  if (csvBuilderRunRowsMatch) {
    const runId = csvBuilderRunRowsMatch[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    if (method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
    try {
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], runId);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      const params = new URLSearchParams(rawQueryString || '');
      const limit = parseLimit(rawQueryString || '', 250, 50);
      const offset = parseOffsetExport(rawQueryString || '');
      const columnKeys = params
        .getAll('column_key')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
      const sortBy = params.get('sort_by')?.trim() || undefined;
      const sortDirection = parseSortDirectionParam(params);
      type TypedCsvBuilderFilter = {
        column_key: string;
        operator: 'contains' | 'equals' | 'empty' | 'not_empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after';
        value: string | number | boolean | null;
      };
      const filters: CsvBuilderFilter[] = parseJsonParam(params, 'filters', [] as Array<Record<string, unknown>>)
        .map((filter) => ({
          column_key: String(filter.column_key ?? '').trim(),
          operator: String(filter.operator ?? '').trim(),
          value: filter.value,
        }))
        .filter(
          (filter): filter is { column_key: string; operator: TypedCsvBuilderFilter['operator']; value: unknown } =>
            Boolean(filter.column_key) && isCsvBuilderFilterOperator(filter.operator),
        )
        .map((filter) => ({
          column_key: filter.column_key,
          operator: filter.operator,
          value:
            typeof filter.value === 'string' ||
            typeof filter.value === 'number' ||
            typeof filter.value === 'boolean' ||
            filter.value == null
              ? filter.value
              : null,
        }));
      const result = await listCsvBuilderRows(leadsClient as unknown as Parameters<typeof listCsvBuilderRows>[0], runId, {
        limit,
        offset,
        columnKeys,
        sortBy,
        sortDirection,
        filters,
      });
      return jsonResponse(200, result);
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to load CSV Builder rows' });
    }
  }

  const csvBuilderRunToolJobsMatch = path.match(/^\/csv-builder\/runs\/([^/]+)\/tool-jobs$/);
  if (csvBuilderRunToolJobsMatch) {
    const runId = csvBuilderRunToolJobsMatch[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    try {
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], runId);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      if (method === 'GET') {
        const jobs = await listCsvBuilderToolJobs(
          leadsClient as unknown as Parameters<typeof listCsvBuilderToolJobs>[0],
          runId,
        );
        return jsonResponse(200, { jobs });
      }
      if (method === 'POST') {
        const parsed = parseJsonBody<{
          label?: string;
          tool_type: string;
          config: CsvBuilderToolJobConfig;
        }>(rawBody || '{}');
        if (!parsed.ok) return parsed.response;
        if (!isCsvBuilderToolType(parsed.value.tool_type)) {
          return jsonResponse(400, { error: 'Unsupported CSV Builder tool type' });
        }
        const result = await createCsvBuilderToolJob(
          leadsClient as unknown as Parameters<typeof createCsvBuilderToolJob>[0],
          runId,
          {
            label: typeof parsed.value.label === 'string' ? parsed.value.label : undefined,
            tool_type: parsed.value.tool_type,
            config: parsed.value.config,
          },
        );
        const startResult = await startCsvBuilderToolJob(leadsClient, result.job.id, actorUserId);
        const startBody = startResult.body ? JSON.parse(startResult.body) : {};
        if (startResult.statusCode >= 400) {
          return jsonResponse(startResult.statusCode, {
            error: startBody.error ?? 'Failed to start CSV Builder tool job',
            detail: startBody.detail,
            job: result.job,
            columns: result.columns,
          });
        }
        return jsonResponse(200, {
          job: startBody.job ?? result.job,
          columns: result.columns,
          foundry_job: startBody.foundry_job ?? null,
          reused: Boolean(startBody.reused),
        });
      }
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to manage CSV Builder tool jobs' });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const csvBuilderToolJobRerunMatch = path.match(/^\/csv-builder\/tool-jobs\/([^/]+)\/rerun$/);
  if (csvBuilderToolJobRerunMatch) {
    const jobId = csvBuilderToolJobRerunMatch[1];
    if (!UUID_RE.test(jobId)) return jsonResponse(400, { error: 'Invalid tool job id' });
    if (method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
    const parsed = parseJsonBody<{ config?: CsvBuilderToolJobConfig }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    try {
      const toolJob = await getCsvBuilderToolJob(
        leadsClient as unknown as Parameters<typeof getCsvBuilderToolJob>[0],
        jobId,
      );
      if (!toolJob) return jsonResponse(404, { error: 'CSV Builder tool job not found' });
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], toolJob.run_id);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      const refreshed = await rerunCsvBuilderToolJob(
        leadsClient as unknown as Parameters<typeof rerunCsvBuilderToolJob>[0],
        jobId,
        parsed.value,
      );
      const startResult = await startCsvBuilderToolJob(leadsClient, refreshed.job.id, actorUserId);
      const startBody = startResult.body ? JSON.parse(startResult.body) : {};
      if (startResult.statusCode >= 400) {
        return jsonResponse(startResult.statusCode, {
          error: startBody.error ?? 'Failed to rerun CSV Builder tool job',
          detail: startBody.detail,
          job: refreshed.job,
          columns: refreshed.columns,
        });
      }
      return jsonResponse(200, {
        job: startBody.job ?? refreshed.job,
        columns: refreshed.columns,
        foundry_job: startBody.foundry_job ?? null,
        reused: Boolean(startBody.reused),
      });
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to rerun CSV Builder tool job' });
    }
  }

  const csvBuilderRerunMatch = path.match(/^\/csv-builder\/columns\/([^/]+)\/rerun$/);
  if (csvBuilderRerunMatch) {
    const columnId = csvBuilderRerunMatch[1];
    if (!UUID_RE.test(columnId)) return jsonResponse(400, { error: 'Invalid column id' });
    if (method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
    const parsed = parseJsonBody<{ tool_config?: Record<string, unknown> }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    try {
      const column = await getCsvBuilderColumn(leadsClient as unknown as Parameters<typeof getCsvBuilderColumn>[0], columnId);
      if (!column) return jsonResponse(404, { error: 'CSV Builder column not found' });
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], column.run_id);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      const refreshed = await rerunCsvBuilderColumn(
        leadsClient as unknown as Parameters<typeof rerunCsvBuilderColumn>[0],
        columnId,
        parsed.value,
      );
      return jsonResponse(200, refreshed);
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to rerun CSV Builder column' });
    }
  }

  const csvBuilderExportMatch = path.match(/^\/csv-builder\/runs\/([^/]+)\/export$/);
  if (csvBuilderExportMatch) {
    const runId = csvBuilderExportMatch[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    if (method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
    const parsed = parseJsonBody<{
      column_keys?: string[];
      sort_by?: string;
      sort_direction?: 'asc' | 'desc';
      filters?: unknown[];
    }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    try {
      const run = await getCsvBuilderRun(leadsClient as unknown as Parameters<typeof getCsvBuilderRun>[0], runId);
      if (!run) return jsonResponse(404, { error: 'CSV Builder run not found' });
      const allowed = await assertAccountMembership(mainClient, actorUserId, run.account_id);
      if (!allowed) return jsonResponse(403, { error: 'Account access denied' });
      return await startCsvBuilderExportJob(leadsClient, runId, actorUserId, {
        columnKeys: Array.isArray(parsed.value.column_keys) ? parsed.value.column_keys : [],
        sortBy: typeof parsed.value.sort_by === 'string' ? parsed.value.sort_by : undefined,
        sortDirection: parsed.value.sort_direction === 'asc' ? 'asc' : 'desc',
        filters: Array.isArray(parsed.value.filters) ? parsed.value.filters : [],
      });
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to start CSV Builder export' });
    }
  }

  if (path === '/cost-rate-cards' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const ck = params.get('cost_kind')?.trim();
    const prov = params.get('provider')?.trim();
    const prod = params.get('product')?.trim();
    if (ck && prov && prod) {
      if (ck !== 'acquisition' && ck !== 'enrichment') {
        return jsonResponse(400, { error: 'cost_kind must be acquisition or enrichment' });
      }
      const rate = await lookupCurrentRate(leadsClient, ck, prov, prod);
      return jsonResponse(200, { rate });
    }
    const { data, error } = await leadsClient
      .from('cost_rate_cards')
      .select('*')
      .is('effective_to', null)
      .order('cost_kind', { ascending: true })
      .order('provider', { ascending: true })
      .order('product', { ascending: true });
    if (error) {
      console.error('cost_rate_cards list failed', error.message);
      return jsonResponse(502, { error: 'Failed to load cost rate cards' });
    }
    return jsonResponse(200, { rates: data ?? [] });
  }

  if (path === '/cost-rate-cards' && method === 'POST') {
    const parsed = parseJsonBody<{
      cost_kind: string;
      provider: string;
      product: string;
      unit_price_cents: number;
      usage_unit?: string;
      unit_quantity?: number;
      currency?: string;
      notes?: string;
      /** When true, set effective_to on any existing current row for this triple. */
      retire_previous?: boolean;
    }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    const v = parsed.value;
    if (v.cost_kind !== 'acquisition' && v.cost_kind !== 'enrichment') {
      return jsonResponse(400, { error: 'cost_kind must be acquisition or enrichment' });
    }
    if (!v.provider?.trim() || !v.product?.trim()) {
      return jsonResponse(400, { error: 'provider and product are required' });
    }
    if (typeof v.unit_price_cents !== 'number' || !Number.isFinite(v.unit_price_cents) || v.unit_price_cents < 0) {
      return jsonResponse(400, { error: 'unit_price_cents must be a non-negative number' });
    }
    if (v.usage_unit != null && (!v.usage_unit.trim() || v.usage_unit.trim().length > 64)) {
      return jsonResponse(400, { error: 'usage_unit must be a non-empty string' });
    }
    if (v.unit_quantity != null && (!Number.isFinite(v.unit_quantity) || v.unit_quantity <= 0)) {
      return jsonResponse(400, { error: 'unit_quantity must be a positive number' });
    }
    if (v.retire_previous === true) {
      await leadsClient
        .from('cost_rate_cards')
        .update({ effective_to: new Date().toISOString() })
        .eq('cost_kind', v.cost_kind)
        .eq('provider', v.provider.trim())
        .eq('product', v.product.trim())
        .is('effective_to', null);
    }
    const { data: inserted, error: insErr } = await leadsClient
      .from('cost_rate_cards')
      .insert({
        cost_kind: v.cost_kind,
        provider: v.provider.trim(),
        product: v.product.trim(),
        unit_price_cents: Math.trunc(v.unit_price_cents),
        usage_unit: typeof v.usage_unit === 'string' && v.usage_unit.trim() ? v.usage_unit.trim() : 'row',
        unit_quantity:
          typeof v.unit_quantity === 'number' && Number.isFinite(v.unit_quantity)
            ? Math.max(1, Math.trunc(v.unit_quantity))
            : 1,
        currency: typeof v.currency === 'string' && v.currency.trim() ? v.currency.trim().toUpperCase() : 'USD',
        notes: typeof v.notes === 'string' ? v.notes : null,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      console.error('cost_rate_cards insert failed', insErr?.message);
      return jsonResponse(502, { error: 'Failed to create cost rate card' });
    }
    return jsonResponse(200, { id: inserted.id });
  }

  if (path.startsWith('/cost-rate-cards/') && method === 'PATCH') {
    const id = path.slice('/cost-rate-cards/'.length);
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{
      unit_price_cents?: number;
      usage_unit?: string;
      unit_quantity?: number;
      effective_to?: string | null;
      notes?: string | null;
    }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    const patch: Record<string, unknown> = {};
    if (typeof parsed.value.unit_price_cents === 'number' && Number.isFinite(parsed.value.unit_price_cents)) {
      patch.unit_price_cents = Math.max(0, Math.trunc(parsed.value.unit_price_cents));
    }
    if (typeof parsed.value.usage_unit === 'string' && parsed.value.usage_unit.trim()) {
      patch.usage_unit = parsed.value.usage_unit.trim();
    }
    if (typeof parsed.value.unit_quantity === 'number' && Number.isFinite(parsed.value.unit_quantity)) {
      patch.unit_quantity = Math.max(1, Math.trunc(parsed.value.unit_quantity));
    }
    if ('effective_to' in parsed.value) {
      patch.effective_to = parsed.value.effective_to;
    }
    if ('notes' in parsed.value) {
      patch.notes = parsed.value.notes;
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse(400, { error: 'No fields to update' });
    }
    const { error: updErr } = await leadsClient.from('cost_rate_cards').update(patch).eq('id', id);
    if (updErr) {
      console.error('cost_rate_cards patch failed', updErr.message);
      return jsonResponse(502, { error: 'Failed to update cost rate card' });
    }
    return jsonResponse(200, { ok: true });
  }

  if (path === '/export/company-owner-leads' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const { includeContact, includeContactConfidence } = parseIncludeContactFlags(params);
    const includeCost = parseIncludeCostFlag(params);
    const includeGoogleAds = parseIncludeGoogleAdsVerificationFlag(params);
    const limit = parseLimit(rawQueryString || '', MAX_EXPORT_LEADS_LIMIT, DEFAULT_EXPORT_LEADS_LIMIT);
    const offset = parseOffsetExport(rawQueryString || '');
    const end = offset + limit - 1;
    const { data, error, count } = await buildExportCompanyOwnerLeadsQuery(
      leadsClient,
      params,
      { withCount: true },
    ).range(offset, end);

    if (error) {
      const err = error as { message?: string; code?: string; details?: string; hint?: string };
      console.error('export_company_owner_leads failed', {
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
        includeContact,
      });
      return jsonResponse(502, { error: 'Failed to load export leads' });
    }

    const rawRows = data ?? [];
    const rows = rawRows.map((r) => {
      const row = { ...(r as Record<string, unknown>) };
      if (includeContact && !includeCost) {
        stripCostFields(row);
      }
      if (includeContact && !includeContactConfidence) {
        stripContactConfidenceFields(row);
      }
      return row;
    });

    if (includeGoogleAds && rows.length > 0) {
      try {
        await mergeGoogleAdsVerificationsIntoExportRows(leadsClient, rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('export_company_owner_leads google ads merge failed', message);
        return jsonResponse(502, { error: 'Failed to load Google Ads verifications for export' });
      }
    }

    return jsonResponse(200, {
      rows,
      limit,
      offset,
      total_count: count ?? 0,
    });
  }

  if (path === '/export/company-chain-people' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const { includeContact, includeContactConfidence } = parseIncludeContactFlags(params);
    const includeCost = parseIncludeCostFlag(params);
    const includeGoogleAds = parseIncludeGoogleAdsVerificationFlag(params);
    const limit = parseLimit(rawQueryString || '', MAX_EXPORT_LEADS_LIMIT, DEFAULT_EXPORT_LEADS_LIMIT);
    const offset = parseOffsetExport(rawQueryString || '');
    const maxDepth = clampOwnershipChainDepth(params.get('max_depth'));
    const maxChains = clampOwnershipChainLimit(params.get('max_chains'));

    let targets: ExportChainTargetRow[] = [];
    let total_count = 0;
    try {
      const paged = await listExportChainTargetsPage(leadsClient, params, limit, offset);
      targets = paged.targets;
      total_count = paged.total_count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('export_company_chain_people target scan failed', message);
      return jsonResponse(502, { error: 'Failed to load chain export targets' });
    }

    const seenRows = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const target of targets) {
      try {
        const chains = await loadOwnershipChainsForTarget(leadsClient, {
          targetStateEntityId: target.state_entity_id,
          targetRegistryState: target.registry_state || target.state_entity_state || '',
          targetRegistryEntityId: target.registry_entity_id,
          targetLegalName: target.state_entity_legal_name,
          maxDepth,
          maxChains,
        });
        for (const chain of chains) {
          const personStep = chain.steps[0];
          if (!personStep || personStep.kind !== 'person') continue;
          const linkagePath = formatOwnershipLinkagePath(chain);
          const rowKey = `${target.company_entity_match_id}:${personStep.owner_row_id}:${linkagePath}`;
          if (seenRows.has(rowKey)) continue;
          seenRows.add(rowKey);
          rows.push({
            company_id: target.company_id,
            company_legal_name: target.company_legal_name,
            company_entity_match_id: target.company_entity_match_id,
            registry_state: target.registry_state,
            state_entity_id: target.state_entity_id,
            registry_entity_id: target.registry_entity_id,
            state_entity_legal_name: target.state_entity_legal_name,
            address_line_1: target.address_line_1,
            address_line_2: target.address_line_2,
            address_city: target.address_city,
            address_state: target.address_state,
            address_postal_code: target.address_postal_code,
            address_country: target.address_country,
            website: target.website,
            has_current_linked_source: target.has_current_linked_source,
            has_current_owner: target.has_current_owner,
            has_open_review_task: target.has_open_review_task,
            has_parse_failure_task: target.has_parse_failure_task,
            is_export_ready: target.is_export_ready,
            person_owner_row_id: personStep.owner_row_id,
            person_name: personStep.name,
            person_first_name: personStep.first_name,
            person_last_name: personStep.last_name,
            person_title_role: personStep.title_role,
            chain_depth: chain.depth,
            linkage_path: linkagePath,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('export_company_chain_people expand failed', target.company_entity_match_id, message);
        return jsonResponse(502, { error: 'Failed to expand ownership chains for export' });
      }
    }

    if (includeCost && rows.length > 0) {
      try {
        const pairs = rows.map((r) => ({
          company_id: String(r.company_id),
          entity_owner_id: String(r.person_owner_row_id),
        }));
        const costMap = await loadExportRowCostMap(leadsClient, pairs);
        for (const row of rows) {
          const key = `${String(row.company_id)}\0${String(row.person_owner_row_id)}`;
          const c = costMap.get(key);
          if (c) {
            row.enrichment_cost_cents = c.enrichment_cost_cents;
            row.company_enrichment_cost_cents = c.company_enrichment_cost_cents;
            row.enrichment_cost_per_row_cents = c.enrichment_cost_per_row_cents;
            row.company_acquisition_cost_cents = c.company_acquisition_cost_cents;
            row.acquisition_cost_per_row_cents = c.acquisition_cost_per_row_cents;
            row.total_cost_per_row_cents = c.total_cost_per_row_cents;
            row.company_export_row_count = c.company_export_row_count;
            row.company_website_verification_cost_cents = c.company_website_verification_cost_cents;
            row.company_google_ads_verification_cost_cents = c.company_google_ads_verification_cost_cents;
            row.company_import_acquisition_cost_cents = c.company_import_acquisition_cost_cents;
            row.company_registry_acquisition_cost_cents = c.company_registry_acquisition_cost_cents;
          } else {
            row.enrichment_cost_cents = 0;
            row.company_enrichment_cost_cents = 0;
            row.enrichment_cost_per_row_cents = 0;
            row.company_acquisition_cost_cents = 0;
            row.acquisition_cost_per_row_cents = 0;
            row.total_cost_per_row_cents = 0;
            row.company_export_row_count = 0;
            row.company_website_verification_cost_cents = 0;
            row.company_google_ads_verification_cost_cents = 0;
            row.company_import_acquisition_cost_cents = 0;
            row.company_registry_acquisition_cost_cents = 0;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('export_company_chain_people cost merge failed', message);
        return jsonResponse(502, { error: 'Failed to load export row costs for chain export' });
      }
    }

    if (includeContact && rows.length > 0) {
      try {
        const pairs = rows.map((r) => ({
          company_id: String(r.company_id),
          entity_owner_id: String(r.person_owner_row_id),
        }));
        const flatMap = await loadOwnerContactEnrichmentFlatMap(
          leadsClient,
          pairs,
          includeContactConfidence,
        );
        for (const row of rows) {
          const key = `${row.company_id}:${row.person_owner_row_id}`;
          applyContactFlatToRow(row, flatMap.get(key), includeContactConfidence);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('export_company_chain_people contact enrichment merge failed', message);
        return jsonResponse(502, { error: 'Failed to load contact enrichment for chain export' });
      }
    }

    if (includeContact && !includeCost) {
      for (const row of rows) {
        stripCostFields(row);
      }
    }

    if (includeGoogleAds && rows.length > 0) {
      try {
        await mergeGoogleAdsVerificationsIntoExportRows(leadsClient, rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('export_company_chain_people google ads merge failed', message);
        return jsonResponse(502, { error: 'Failed to load Google Ads verifications for chain export' });
      }
    }

    return jsonResponse(200, {
      rows,
      limit,
      offset,
      total_count,
      targets_returned: targets.length,
    });
  }

  const contactEnrichmentPreflight = path.match(/^\/ingestion-runs\/([^/]+)\/contact-enrichment\/preflight$/);
  if (contactEnrichmentPreflight && method === 'POST') {
    const runId = contactEnrichmentPreflight[1];
    if (!UUID_RE.test(runId)) return jsonResponse(400, { error: 'Invalid run id' });
    const parsed = parseJsonBody<{
      freshness_window_days?: number;
      force_rerun_recent?: boolean;
      strong_targets_only?: boolean;
      ruleset_preset?: string;
      queue_ambiguous_for_review?: boolean;
    }>(rawBody || '{}');
    if (!parsed.ok) return parsed.response;
    try {
      const rp = parsed.value.ruleset_preset;
      const rulesetPreset =
        rp === 'conservative' || rp === 'balanced' || rp === 'aggressive' ? rp : undefined;
      const options = resolveContactEnrichmentOptions({
        freshnessWindowDays:
          typeof parsed.value.freshness_window_days === 'number'
            ? parsed.value.freshness_window_days
            : undefined,
        forceRerunRecent:
          typeof parsed.value.force_rerun_recent === 'boolean' ? parsed.value.force_rerun_recent : undefined,
        strongTargetsOnly:
          typeof parsed.value.strong_targets_only === 'boolean' ? parsed.value.strong_targets_only : undefined,
        rulesetPreset,
        queueAmbiguousForReview:
          typeof parsed.value.queue_ambiguous_for_review === 'boolean'
            ? parsed.value.queue_ambiguous_for_review
            : undefined,
      });
      const activeJob = await leadsClient
        .from('foundry_jobs')
        .select('id')
        .eq('job_type', 'contact_enrichment_import_run')
        .contains('payload', { ingestion_run_id: runId })
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeJob.error) throw new Error(activeJob.error.message);
      const preflight = await buildContactEnrichmentPreflight(leadsClient, runId, options);
      return jsonResponse(200, {
        ingestion_run_id: preflight.ingestion_run_id,
        source_name: preflight.source_name,
        active_job_id: activeJob.data?.id ?? null,
        options: {
          freshness_window_days: preflight.options.freshnessWindowDays,
          force_rerun_recent: preflight.options.forceRerunRecent,
          strong_targets_only: preflight.options.strongTargetsOnly,
          ruleset_preset: preflight.options.rulesetPreset,
          queue_ambiguous_for_review: preflight.options.queueAmbiguousForReview,
        },
        counts: preflight.counts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('contact enrichment preflight failed', runId, message);
      return jsonResponse(502, { error: 'Failed to build contact enrichment preflight', detail: message });
    }
  }

  const mCoOwnership = path.match(/^\/companies\/([^/]+)\/ownership-chains$/);
  if (mCoOwnership && method === 'GET') {
    const id = mCoOwnership[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const params = new URLSearchParams(rawQueryString || '');
    const maxDepth = clampOwnershipChainDepth(params.get('max_depth'));
    const maxChains = clampOwnershipChainLimit(params.get('max_chains'));

    const { data: company, error: companyErr } = await leadsClient
      .from('companies')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (companyErr) return jsonResponse(502, { error: companyErr.message });
    if (!company) return jsonResponse(404, { error: 'Not found' });

    const { data: matches, error: matchesErr } = await leadsClient
      .from('company_entity_matches')
      .select('id, state_entity_id, registry_state')
      .eq('company_id', id)
      .eq('is_current', true)
      .eq('match_status', 'promoted')
      .order('registry_state', { ascending: true })
      .order('id', { ascending: true });
    if (matchesErr) return jsonResponse(502, { error: matchesErr.message });

    const targetEntityIds = [...new Set((matches ?? []).map((row) => String(row.state_entity_id)).filter(Boolean))];
    const { data: targetEntities, error: entErr } = targetEntityIds.length
      ? await leadsClient
          .from('state_entities')
          .select('id, state, registry_entity_id, legal_name')
          .in('id', targetEntityIds)
      : { data: [], error: null };
    if (entErr) return jsonResponse(502, { error: entErr.message });
    const byEntityId = new Map(
      (targetEntities ?? []).map((row) => [
        String(row.id),
        {
          state: typeof row.state === 'string' ? row.state : '',
          registry_entity_id: row.registry_entity_id == null ? null : String(row.registry_entity_id),
          legal_name: row.legal_name == null ? null : String(row.legal_name),
        },
      ]),
    );

    const targets: OwnershipChainTarget[] = [];
    for (const match of matches ?? []) {
      const stateEntityId = String(match.state_entity_id);
      const meta = byEntityId.get(stateEntityId);
      const chains = await loadOwnershipChainsForTarget(leadsClient, {
        targetStateEntityId: stateEntityId,
        targetRegistryState: (match.registry_state as string) || meta?.state || '',
        targetRegistryEntityId: meta?.registry_entity_id ?? null,
        targetLegalName: meta?.legal_name ?? null,
        maxDepth,
        maxChains,
      });
      targets.push({
        company_entity_match_id: String(match.id),
        registry_state: (match.registry_state as string) || meta?.state || '',
        state_entity_id: stateEntityId,
        registry_entity_id: meta?.registry_entity_id ?? null,
        legal_name: meta?.legal_name ?? null,
        chains,
      });
    }

    return jsonResponse(200, { company_id: id, max_depth: maxDepth, targets });
  }

  if (path === '/entity-owners' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const limit = parseLimit(rawQueryString || '', 100, 50);
    const offset = parseOffsetExport(rawQueryString || '');
    const idsRaw = params.get('ids')?.trim();
    const EO_SELECT =
      'id, state_entity_id, owner_name, title_role, first_name, last_name, owner_normalized_key, is_current, observed_at';

    if (idsRaw) {
      const parts = idsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = [...new Set(parts)].filter((id) => UUID_RE.test(id)).slice(0, 50);
      if (unique.length === 0) {
        return jsonResponse(400, { error: 'ids must include at least one valid UUID' });
      }
      const { data, error } = await leadsClient.from('entity_owners').select(EO_SELECT).in('id', unique);
      if (error) {
        console.error('entity_owners batch select failed', error.message);
        return jsonResponse(502, { error: 'Failed to load entity owners' });
      }
      const byId = new Map((data ?? []).map((row) => [row.id as string, row]));
      const ordered = unique.map((id) => byId.get(id)).filter(Boolean);
      return jsonResponse(200, { entity_owners: ordered });
    }

    const seId = params.get('state_entity_id')?.trim() ?? '';
    const onk = params.get('owner_normalized_key')?.trim() ?? '';
    if (seId && UUID_RE.test(seId) && onk.length > 0) {
      const limitCl = Math.min(limit, 50);
      const { data, error } = await leadsClient
        .from('entity_owners')
        .select(EO_SELECT)
        .eq('state_entity_id', seId)
        .eq('owner_normalized_key', onk)
        .eq('is_current', true)
        .order('id', { ascending: true })
        .limit(limitCl);
      if (error) {
        console.error('entity_owners cluster select failed', error.message);
        return jsonResponse(502, { error: 'Failed to load entity owners' });
      }
      return jsonResponse(200, { entity_owners: data ?? [] });
    }
    const qSearch = params.get('q')?.trim() ?? '';
    const hasOwnerNormalizedKey = parseTriStateBoolParam(params, 'has_owner_normalized_key');
    const isCurrent = parseTriStateBoolParam(params, 'is_current');
    const exactStateEntityId = params.get('state_entity_id')?.trim() ?? '';
    const sortDirection = parseSortDirectionParam(params);
    const sortBy =
      params.get('sort_by') === 'title'
        ? 'title_role'
        : params.get('sort_by') === 'names'
          ? 'first_name'
          : params.get('sort_by') === 'current'
            ? 'is_current'
            : 'owner_name';

    let qb = leadsClient.from('entity_owners').select(EO_SELECT, { count: 'exact' });
    if (qSearch.length >= 2) {
      qb = qb.ilike('owner_name', `%${escapeIlikePatternExport(qSearch)}%`);
    }
    if (hasOwnerNormalizedKey === true) qb = qb.not('owner_normalized_key', 'is', null);
    else if (hasOwnerNormalizedKey === false) qb = qb.is('owner_normalized_key', null);
    if (isCurrent !== undefined) qb = qb.eq('is_current', isCurrent);
    if (exactStateEntityId && UUID_RE.test(exactStateEntityId)) {
      qb = qb.eq('state_entity_id', exactStateEntityId);
    }
    qb = qb.order(sortBy, { ascending: sortDirection === 'asc', nullsFirst: sortDirection !== 'asc' });
    if (sortBy === 'first_name') {
      qb = qb.order('last_name', { ascending: sortDirection === 'asc', nullsFirst: sortDirection !== 'asc' });
    }
    qb = qb.order('observed_at', { ascending: false }).order('id', { ascending: true });
    const end = offset + limit - 1;
    const { data, error, count } = await qb.range(offset, end);
    if (error) {
      console.error('entity_owners list failed', error.message);
      return jsonResponse(502, { error: 'Failed to load entity owners' });
    }
    return jsonResponse(200, {
      entity_owners: data ?? [],
      limit,
      offset,
      total_count: count ?? 0,
    });
  }

  if (path === '/entity-owners/merge' && method === 'POST') {
    const parsed = parseJsonBody<{
      survivor_entity_owner_id?: string;
      other_entity_owner_ids?: string[];
      merged?: {
        owner_name?: string;
        title_role?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      };
      review_task_id?: string;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const survivor = parsed.value.survivor_entity_owner_id;
    const others = parsed.value.other_entity_owner_ids ?? [];
    if (!survivor || !UUID_RE.test(survivor)) {
      return jsonResponse(400, { error: 'survivor_entity_owner_id required' });
    }
    if (!others.length) return jsonResponse(400, { error: 'other_entity_owner_ids required' });
    for (const o of others) {
      if (!UUID_RE.test(o)) return jsonResponse(400, { error: 'Invalid entity_owner id' });
    }
    const r = await mergeEntityOwners(leadsClient, {
      survivor_entity_owner_id: survivor,
      other_entity_owner_ids: others,
      merged: parsed.value.merged,
    });
    if ('error' in r) return jsonResponse(400, { error: r.error });
    const rt = parsed.value.review_task_id;
    if (rt && UUID_RE.test(rt)) {
      await leadsClient
        .from('review_tasks')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution: { via: 'foundry_entity_owner_merge', resolved_by: actorUserId, merge_log: r.merge_log },
        })
        .eq('id', rt)
        .in('status', ['pending', 'in_progress']);
    }
    return jsonResponse(200, r);
  }

  if (path === '/entity-owners/delete-preflight' && method === 'POST') {
    const parsed = parseJsonBody<{ entity_owner_id?: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.entity_owner_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'entity_owner_id required' });
    const impact = await loadEntityOwnerDeleteImpact(leadsClient, id);
    const fp = entityOwnerDeleteImpactFingerprint(impact);
    const confirmation_token = signEntityOwnerDeleteConfirm(id, fp, hmacSecret);
    return jsonResponse(200, {
      impact,
      safe: isEntityOwnerDeleteSafe(impact),
      confirmation_token,
    });
  }

  if (path === '/entity-owners/delete' && method === 'POST') {
    const parsed = parseJsonBody<{
      entity_owner_id?: string;
      force_cascade?: boolean;
      confirmation_token?: string;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.entity_owner_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'entity_owner_id required' });
    const impact = await loadEntityOwnerDeleteImpact(leadsClient, id);
    const fp = entityOwnerDeleteImpactFingerprint(impact);
    const safe = isEntityOwnerDeleteSafe(impact);
    if (!safe) {
      if (!parsed.value.force_cascade) {
        return jsonResponse(400, { error: 'delete_not_safe', impact });
      }
      const tok = parsed.value.confirmation_token;
      if (!tok || !verifyEntityOwnerDeleteConfirm(id, fp, tok, hmacSecret)) {
        return jsonResponse(403, { error: 'invalid_confirmation_token', impact });
      }
    }
    const { error } = await leadsClient.from('entity_owners').delete().eq('id', id);
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  if (path === '/source-records' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const limit = parseLimit(rawQueryString || '', 100, 50);
    const offset = parseOffsetExport(rawQueryString || '');
    const qSearch = params.get('q')?.trim() ?? '';
    const runId = params.get('ingestion_run_id')?.trim() ?? '';
    let qb = leadsClient
      .from('source_business_records')
      .select(
        'id, ingestion_run_id, source_name, name_raw, website, address_raw, observed_at, created_at, resolution_meta',
        { count: 'exact' },
      );
    if (runId && UUID_RE.test(runId)) qb = qb.eq('ingestion_run_id', runId);
    if (qSearch.length >= 2) {
      qb = qb.ilike('name_raw', `%${escapeIlikePatternExport(qSearch)}%`);
    }
    qb = qb.order('created_at', { ascending: false });
    const end = offset + limit - 1;
    const { data, error, count } = await qb.range(offset, end);
    if (error) {
      console.error('source_business_records list failed', error.message);
      return jsonResponse(502, { error: 'Failed to load source records' });
    }
    return jsonResponse(200, {
      records: data ?? [],
      limit,
      offset,
      total_count: count ?? 0,
    });
  }

  if (path === '/source-records/merge' && method === 'POST') {
    const parsed = parseJsonBody<{
      survivor_source_business_record_id?: string;
      other_source_business_record_ids?: string[];
      merged?: { name_raw?: string; website?: string | null; address_raw?: string | null };
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const surv = parsed.value.survivor_source_business_record_id;
    const others = parsed.value.other_source_business_record_ids ?? [];
    if (!surv || !UUID_RE.test(surv)) return jsonResponse(400, { error: 'survivor_source_business_record_id required' });
    if (!others.length) return jsonResponse(400, { error: 'other_source_business_record_ids required' });
    for (const o of others) {
      if (!UUID_RE.test(o)) return jsonResponse(400, { error: 'Invalid source record id' });
    }
    const r = await mergeSourceBusinessRecords(leadsClient, {
      survivor_source_business_record_id: surv,
      other_source_business_record_ids: others,
      merged: parsed.value.merged,
    });
    if ('error' in r) return jsonResponse(400, { error: r.error });
    return jsonResponse(200, r);
  }

  if (path === '/source-records/delete-preflight' && method === 'POST') {
    const parsed = parseJsonBody<{ source_business_record_id?: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.source_business_record_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'source_business_record_id required' });
    const impact = await loadSourceRecordDeleteImpact(leadsClient, id);
    const fp = sourceRecordDeleteFingerprint(impact.current_link_count);
    const confirmation_token = signSourceRecordDeleteConfirm(id, fp, hmacSecret);
    return jsonResponse(200, {
      impact,
      safe: isSourceRecordDeleteSafe(impact),
      confirmation_token,
    });
  }

  if (path === '/source-records/delete' && method === 'POST') {
    const parsed = parseJsonBody<{
      source_business_record_id?: string;
      force_cascade?: boolean;
      confirmation_token?: string;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.source_business_record_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'source_business_record_id required' });
    const impact = await loadSourceRecordDeleteImpact(leadsClient, id);
    const fp = sourceRecordDeleteFingerprint(impact.current_link_count);
    const safe = isSourceRecordDeleteSafe(impact);
    if (!safe) {
      if (!parsed.value.force_cascade) {
        return jsonResponse(400, { error: 'delete_not_safe', impact });
      }
      const tok = parsed.value.confirmation_token;
      if (!tok || !verifySourceRecordDeleteConfirm(id, fp, tok, hmacSecret)) {
        return jsonResponse(403, { error: 'invalid_confirmation_token', impact });
      }
    }
    const { error } = await leadsClient.from('source_business_records').delete().eq('id', id);
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  const mSource = path.match(/^\/source-records\/([^/]+)$/);
  if (mSource && method === 'GET') {
    const id = mSource[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const detail = await getSourceRecordDetail(leadsClient, id);
    if (!detail) return jsonResponse(404, { error: 'Not found' });
    return jsonResponse(200, detail);
  }

  const mNorm = path.match(/^\/ingestion-runs\/([^/]+)\/normalize-records$/);
  if (mNorm && method === 'POST') {
    const id = mNorm[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid run id' });
    const parsed = parseJsonBody<{ limit?: number }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const limit = Math.min(2000, Math.max(1, Number(parsed.value.limit) || 500));
    try {
      const r = await normalizeIngestionRunRecords(leadsClient, id, limit);
      return jsonResponse(200, r);
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : 'normalize failed' });
    }
  }

  const mCand = path.match(/^\/source-records\/([^/]+)\/candidates\/generate$/);
  if (mCand && method === 'POST') {
    const id = mCand[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const r = await generateCandidatesForSourceRecord(leadsClient, id);
    if ('error' in r && r.error === 'not_found') return jsonResponse(404, { error: 'Not found' });
    if ('error' in r && r.error === 'normalize_first') return jsonResponse(400, { error: r.message });
    return jsonResponse(200, r);
  }

  const mLink = path.match(/^\/source-records\/([^/]+)\/link$/);
  if (mLink && method === 'POST') {
    const id = mLink[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{ companyId?: string; createNew?: boolean }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const r = await linkSourceToCompany(leadsClient, id, parsed.value);
    if ('error' in r) return jsonResponse(400, { error: r.message ?? r.error });
    return jsonResponse(200, r);
  }

  const mRej = path.match(/^\/source-records\/([^/]+)\/reject-candidates$/);
  if (mRej && method === 'POST') {
    const id = mRej[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    await rejectCandidatesForSource(leadsClient, id);
    return jsonResponse(200, { ok: true });
  }

  if (path === '/resolution/bulk' && method === 'POST') {
    const parsed = parseJsonBody<{ sourceBusinessRecordIds?: string[]; maxRecords?: number }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const ids = parsed.value.sourceBusinessRecordIds ?? [];
    const maxN = Math.min(100, Math.max(1, Number(parsed.value.maxRecords) || 50));
    const r = await bulkAutoResolve(leadsClient, ids, maxN);
    return jsonResponse(200, r);
  }

  if (path === '/companies/merge' && method === 'POST') {
    const parsed = parseJsonBody<{
      survivor_company_id?: string;
      other_company_ids?: string[];
      merged?: { legal_name?: string; notes?: string | null };
      review_task_id?: string;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const survivor = parsed.value.survivor_company_id;
    const others = parsed.value.other_company_ids ?? [];
    if (!survivor || !UUID_RE.test(survivor)) return jsonResponse(400, { error: 'survivor_company_id required' });
    if (!others.length) return jsonResponse(400, { error: 'other_company_ids required' });
    for (const o of others) {
      if (!UUID_RE.test(o)) return jsonResponse(400, { error: 'Invalid company id' });
    }
    const r = await mergeCompanies(leadsClient, {
      survivor_company_id: survivor,
      other_company_ids: others,
      merged: parsed.value.merged,
    });
    if ('error' in r) return jsonResponse(400, { error: r.error });
    const rt = parsed.value.review_task_id;
    if (rt && UUID_RE.test(rt)) {
      await leadsClient
        .from('review_tasks')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution: { via: 'foundry_merge', resolved_by: actorUserId, merge_log: r.merge_log },
        })
        .eq('id', rt)
        .in('status', ['pending', 'in_progress']);
    }
    return jsonResponse(200, r);
  }

  if (path === '/companies/delete-preflight' && method === 'POST') {
    const parsed = parseJsonBody<{ company_id?: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.company_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'company_id required' });
    const impact = await loadCompanyDeleteImpact(leadsClient, id);
    const fp = companyDeleteImpactFingerprint(impact);
    const confirmation_token = signCompanyDeleteConfirm(id, fp, hmacSecret);
    return jsonResponse(200, {
      impact,
      safe: isCompanyDeleteSafe(impact),
      confirmation_token,
    });
  }

  if (path === '/companies/delete' && method === 'POST') {
    const parsed = parseJsonBody<{
      company_id?: string;
      force_cascade?: boolean;
      confirmation_token?: string;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const id = parsed.value.company_id;
    if (!id || !UUID_RE.test(id)) return jsonResponse(400, { error: 'company_id required' });
    const impact = await loadCompanyDeleteImpact(leadsClient, id);
    const fp = companyDeleteImpactFingerprint(impact);
    const safe = isCompanyDeleteSafe(impact);
    if (!safe) {
      if (!parsed.value.force_cascade) {
        return jsonResponse(400, { error: 'delete_not_safe', impact });
      }
      const tok = parsed.value.confirmation_token;
      if (!tok || !verifyCompanyDeleteConfirm(id, fp, tok, hmacSecret)) {
        return jsonResponse(403, { error: 'invalid_confirmation_token', impact });
      }
    }
    const { error } = await leadsClient.from('companies').delete().eq('id', id);
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  const mCoGet = path.match(/^\/companies\/([^/]+)$/);
  if (mCoGet && method === 'GET') {
    const id = mCoGet[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const { data: co, error } = await leadsClient
      .from('companies')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return jsonResponse(502, { error: error.message });
    if (!co) return jsonResponse(404, { error: 'Not found' });
    const { data: locs } = await leadsClient.from('company_locations').select('*').eq('company_id', id);
    const { data: links } = await leadsClient
      .from('source_business_company_links')
      .select('id, source_business_record_id, link_status, link_score, is_current, created_at')
      .eq('company_id', id)
      .eq('is_current', true);
    const recordIds = [...new Set((links ?? []).map((l) => String(l.source_business_record_id)))];
    const websiteByRecordId = new Map<string, string | null>();
    if (recordIds.length > 0) {
      const { data: recs } = await leadsClient
        .from('source_business_records')
        .select('id, website')
        .in('id', recordIds);
      for (const r of recs ?? []) {
        const w = r.website as string | null | undefined;
        const t = typeof w === 'string' ? w.trim() : '';
        websiteByRecordId.set(String(r.id), t.length > 0 ? t : null);
      }
    }
    const sourceLinksOut = (links ?? []).map((l) => ({
      ...l,
      website: websiteByRecordId.get(String(l.source_business_record_id)) ?? null,
    }));
    const { data: matches } = await leadsClient
      .from('company_entity_matches')
      .select('id, state_entity_id, match_status, match_score, registry_state, is_current')
      .eq('company_id', id)
      .eq('is_current', true);
    const entityIds = [...new Set((matches ?? []).map((m) => m.state_entity_id as string))];
    const entityIdToRegistryState = new Map(
      (matches ?? []).map((m) => [m.state_entity_id as string, (m.registry_state as string) || '']),
    );
    let associatedPeople: Record<string, unknown>[] = [];
    if (entityIds.length > 0) {
      const { data: ownerRows, error: ownersErr } = await leadsClient
        .from('entity_owners')
        .select(
          'id, state_entity_id, owner_name, title_role, effective_at, ended_at, observed_at, is_current, first_name, last_name, owner_normalized_key',
        )
        .in('state_entity_id', entityIds)
        .eq('is_current', true)
        .order('owner_name', { ascending: true });
      if (ownersErr) return jsonResponse(502, { error: ownersErr.message });
      associatedPeople = (ownerRows ?? []).map((row) => ({
        ...row,
        registry_state: entityIdToRegistryState.get(row.state_entity_id as string) || null,
      }));
    }
    const { data: websiteVerification, error: websiteVerificationErr } = await leadsClient
      .from('company_website_verifications')
      .select('*')
      .eq('company_id', id)
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (websiteVerificationErr) return jsonResponse(502, { error: websiteVerificationErr.message });
    const { data: googleAdsVerification, error: googleAdsVerificationErr } = await leadsClient
      .from('company_google_ads_verifications')
      .select('*')
      .eq('company_id', id)
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (googleAdsVerificationErr) return jsonResponse(502, { error: googleAdsVerificationErr.message });
    return jsonResponse(200, {
      company: co,
      locations: locs ?? [],
      source_links: sourceLinksOut,
      entity_matches: matches ?? [],
      associated_people: associatedPeople,
      website_verification: websiteVerification ?? null,
      google_ads_verification: googleAdsVerification ?? null,
    });
  }

  if (mCoGet && method === 'PATCH') {
    const id = mCoGet[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{ legal_name?: string; notes?: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const patch: Record<string, unknown> = {};
    if (parsed.value.legal_name != null) patch.legal_name = parsed.value.legal_name;
    if (parsed.value.notes != null) patch.notes = parsed.value.notes;
    const { data, error } = await leadsClient.from('companies').update(patch).eq('id', id).select('*').single();
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { company: data });
  }

  const mLoc = path.match(/^\/companies\/([^/]+)\/locations$/);
  if (mLoc && method === 'POST') {
    const id = mLoc[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{
      line1?: string;
      city?: string;
      state_region?: string;
      postal_code?: string;
      is_primary?: boolean;
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    if (parsed.value.is_primary) {
      await leadsClient.from('company_locations').update({ is_primary: false }).eq('company_id', id);
    }
    const { data, error } = await leadsClient
      .from('company_locations')
      .insert({
        company_id: id,
        line1: parsed.value.line1 ?? null,
        city: parsed.value.city ?? null,
        state_region: parsed.value.state_region ?? null,
        postal_code: parsed.value.postal_code ?? null,
        is_primary: Boolean(parsed.value.is_primary),
      })
      .select('*')
      .single();
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { location: data });
  }

  if (path === '/review-tasks' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const status = params.get('status') || undefined;
    const task_type = params.get('task_type') || undefined;
    const limit = parseLimit(rawQueryString || '', 200, 50);
    const rows = await listReviewTasks(leadsClient, { status, task_type, limit });
    return jsonResponse(200, { tasks: rows });
  }

  const mRt = path.match(/^\/review-tasks\/([^/]+)$/);
  if (mRt && method === 'GET') {
    const id = mRt[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const t = await getReviewTask(leadsClient, id);
    if (!t) return jsonResponse(404, { error: 'Not found' });
    return jsonResponse(200, { task: t });
  }

  const mRtAssign = path.match(/^\/review-tasks\/([^/]+)\/assign$/);
  if (mRtAssign && method === 'PATCH') {
    const id = mRtAssign[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{ assigned_to: string }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const { error } = await leadsClient
      .from('review_tasks')
      .update({ assigned_to: parsed.value.assigned_to, status: 'in_progress' })
      .eq('id', id);
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  const mRtRes = path.match(/^\/review-tasks\/([^/]+)\/resolve$/);
  if (mRtRes && method === 'POST') {
    const id = mRtRes[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const parsed = parseJsonBody<{
      resolution?: Record<string, unknown>;
      chosen_company_id?: string;
      chosen_match_action?: 'promote' | 'reject';
      company_dedupe_dismiss?: boolean;
      company_dedupe_merge?: {
        survivor_company_id: string;
        other_company_ids: string[];
        merged?: { legal_name?: string; notes?: string | null };
      };
      entity_owner_dedupe_dismiss?: boolean;
      entity_owner_dedupe_merge?: {
        survivor_entity_owner_id: string;
        other_entity_owner_ids: string[];
        merged?: {
          owner_name?: string;
          title_role?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        };
      };
    }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const r = await resolveReviewTask(leadsClient, id, { ...parsed.value, resolution: parsed.value.resolution ?? {} }, actorUserId);
    if ('error' in r) return jsonResponse(400, { error: r.error });
    return jsonResponse(200, r);
  }

  const mRtCan = path.match(/^\/review-tasks\/([^/]+)\/cancel$/);
  if (mRtCan && method === 'POST') {
    const id = mRtCan[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    await leadsClient.from('review_tasks').update({ status: 'cancelled' }).eq('id', id);
    return jsonResponse(200, { ok: true });
  }

  if (path === '/state-matching/preflight' && method === 'POST') {
    const parsed = parseJsonBody<{ companyIds: string[] }>(rawBody);
    if (!parsed.ok) return parsed.response;
    const pre = await stateMatchingPreflight(leadsClient, { companyIds: parsed.value.companyIds ?? [] });
    const buckets = await bucketCompaniesForMatching(leadsClient, pre.ready);
    return jsonResponse(200, {
      ...pre,
      automation_buckets: {
        utah_company_ids: buckets.utahCompanyIds,
        florida_company_ids: buckets.floridaCompanyIds,
        iowa_company_ids: buckets.iowaCompanyIds,
        unsupported: buckets.unsupported,
      },
    });
  }

  const mBatch = path.match(/^\/state-matching\/batches\/([^/]+)$/);
  if (mBatch && method === 'GET') {
    const id = mBatch[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const { data, error } = await leadsClient.from('reconciliation_runs').select('*').eq('id', id).maybeSingle();
    if (error) return jsonResponse(502, { error: error.message });
    if (!data) return jsonResponse(404, { error: 'Not found' });
    const { data: results } = await leadsClient.from('reconciliation_results').select('*').eq('reconciliation_run_id', id);
    return jsonResponse(200, { run: data, results: results ?? [] });
  }

  const mRec = path.match(/^\/reconciliation\/runs\/([^/]+)$/);
  if (mRec && method === 'GET') {
    const id = mRec[1];
    if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'Invalid id' });
    const { data, error } = await leadsClient.from('reconciliation_runs').select('*').eq('id', id).maybeSingle();
    if (error) return jsonResponse(502, { error: error.message });
    if (!data) return jsonResponse(404, { error: 'Not found' });
    const { data: results } = await leadsClient.from('reconciliation_results').select('*').eq('reconciliation_run_id', id);
    return jsonResponse(200, { run: data, results: results ?? [] });
  }

  return null;
}
