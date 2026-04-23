import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import {
  parseCompanyDetailResponse,
  parseCompanyOwnershipChainsResponse,
  type ExportCompanyChainPeopleResponse,
  type ExportCompanySummaryResponse,
  type ParsedCompanyDetail,
  type CompanyOwnershipChainsResponse,
  type ExportCompanyOwnerLeadsResponse,
  type FoundryJobDetailResponse,
  type FoundryJobsListResponse,
  type IngestionRunPipelineJobsResponse,
  type IngestionRunDetailResponse,
  type IngestionRunRecordsResponse,
  type IngestionRunsListResponse,
  type ManualCompaniesListResponse,
  type ManualEntityOwnersListResponse,
  type NormalizeRunRecordsResponse,
  type CostRateCardCurrentResponse,
  type CostRateCardsListResponse,
  type PostGoogleMapsImportBody,
  type PostGoogleMapsImportResponse,
  type PostStartContactEnrichmentJobResponse,
  type PostStartAutolinkJobResponse,
  type PostStartNormalizeJobResponse,
  type ContactEnrichmentPreflightOptions,
  type ContactEnrichmentPreflightResponse,
  type PostStartGoogleAdsVerificationJobResponse,
  type PostStartWebsiteVerificationJobResponse,
  type RegistryCompaniesResponse,
  type RegistryEntityOwnersResponse,
  type ReviewTasksListResponse,
  type GenerateCandidatesResponse,
  type SourceRecordDetailResponse,
  type StateMatchingPreflightResponse,
  type CompanyDeletePreflightResponse,
  type SourceRecordDeletePreflightResponse,
  type SourceRecordsListResponse,
  type CompanyMergeResponse,
  type CsvBuilderFilter,
  type CsvBuilderColumnsResponse,
  type CsvBuilderToolJobsResponse,
  type CsvBuilderRowsQuery,
  type CsvBuilderRowsResponse,
  type CsvBuilderRunDetailResponse,
  type CsvBuilderRunsListResponse,
  type PostCreateCsvBuilderColumnBody,
  type PostCreateCsvBuilderColumnResponse,
  type PostCreateCsvBuilderRunBody,
  type PostCreateCsvBuilderRunResponse,
  type PostCreateCsvBuilderToolJobBody,
  type PostCreateCsvBuilderToolJobResponse,
  type PostCsvBuilderExportBody,
  type PostCsvBuilderExportResponse,
  type PostRerunCsvBuilderColumnBody,
  type PostRerunCsvBuilderColumnResponse,
  type PostRerunCsvBuilderToolJobBody,
  type PostRerunCsvBuilderToolJobResponse,
  type EntityOwnerDeletePreflightResponse,
  type EntityOwnerMergeResponse,
  type SourceRecordsMergeResponse,
} from '@/lib/foundry/registry-types';

const custom = (
  outputs as {
    custom?: {
      foundryRegistryApiUrl?: string;
    };
  }
).custom;

const FOUNDRY_REGISTRY_API_URL = custom?.foundryRegistryApiUrl;

const CONFIG_ERROR =
  'Foundry registry API URL not configured. Deploy the Amplify backend, set LEADS_SUPABASE_URL for synth, run `npx ampx sandbox secret set LEADS_SUPABASE_SECRET_KEY`, and ensure amplify_outputs.json includes custom.foundryRegistryApiUrl.';

function registryBaseUrl(): string {
  if (!FOUNDRY_REGISTRY_API_URL) {
    throw new Error(CONFIG_ERROR);
  }
  return FOUNDRY_REGISTRY_API_URL.replace(/\/?$/, '/');
}

type RegistrySearchValue =
  | string
  | number
  | undefined
  | null
  | Array<string | number | undefined | null>;

function registryUrl(path: string, search?: Record<string, RegistrySearchValue>): string {
  const base = registryBaseUrl();
  const u = new URL(path.replace(/^\//, ''), base);
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item != null && item !== '') u.searchParams.append(k, String(item));
        }
        continue;
      }
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function coerceNonNegativeInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim().length > 0 ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

async function registryFetchJson<T>(
  path: string,
  init: RequestInit & { search?: Record<string, RegistrySearchValue> },
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to load registry data.');
  }
  const url = registryUrl(path, init.search);
  const { search: _s, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...rest.headers,
    },
  });
  if (!res.ok) {
    const rawText = await res.text();
    let body = {} as { error?: string; detail?: string } & Record<string, unknown>;
    try {
      if (rawText.trim()) body = JSON.parse(rawText) as typeof body;
    } catch {
      /* leave body as {} */
    }
    let msg = (body.error as string) || `Registry request failed (${res.status})`;
    const detail = typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : '';
    if (detail) msg = `${msg}: ${detail}`;
    if (!body.error && !detail && rawText.length > 0 && rawText.length < 500) {
      msg = `${msg}: ${rawText.trim()}`;
    }
    throw new Error(msg);
  }
  const body = (await res.json().catch(() => ({}))) as T & Record<string, unknown>;
  return body as T;
}

function companiesListUrl(params?: { limit?: number; q?: string }): string {
  const q =
    params?.q != null && params.q.trim().length >= 2 ? params.q.trim() : undefined;
  return registryUrl('companies', {
    limit: params?.limit,
    q,
  });
}

/**
 * List companies from the registry (leads) database via the Foundry Lambda.
 * Pass `q` (min 2 characters) to filter by legal_name (ilike).
 */
export async function fetchRegistryCompanies(params?: {
  limit?: number;
  q?: string;
}): Promise<RegistryCompaniesResponse> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to load registry data.');
  }

  const res = await fetch(companiesListUrl(params), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string; companies?: unknown };

  if (!res.ok) {
    throw new Error(body.error || `Registry request failed (${res.status})`);
  }

  return body as RegistryCompaniesResponse;
}

export async function fetchManualCompanies(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  has_normalized_key?: boolean;
  has_notes?: boolean;
  sort_by?: string;
  sort_direction?: 'asc' | 'desc';
}): Promise<ManualCompaniesListResponse> {
  const q = params?.q?.trim();
  const response = await registryFetchJson<ManualCompaniesListResponse>('companies', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      has_normalized_key:
        params?.has_normalized_key == null ? undefined : String(params.has_normalized_key),
      has_notes: params?.has_notes == null ? undefined : String(params.has_notes),
      sort_by: params?.sort_by,
      sort_direction: params?.sort_direction,
    },
  });
  return {
    companies: Array.isArray(response.companies) ? response.companies : [],
    limit: coerceNonNegativeInt(response.limit, params?.limit ?? 0),
    offset: coerceNonNegativeInt(response.offset, params?.offset ?? 0),
    total_count: coerceNonNegativeInt(response.total_count, 0),
  };
}

/** Batch fetch companies by id (order preserved; max 50 ids). */
export async function fetchCompaniesByIds(ids: string[]): Promise<RegistryCompaniesResponse> {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 50);
  if (uniq.length === 0) {
    return { companies: [] };
  }
  return registryFetchJson<RegistryCompaniesResponse>('companies', {
    method: 'GET',
    search: { ids: uniq.join(',') },
  });
}

/** All companies sharing a normalized_key (for legacy dedupe payloads). */
export async function fetchCompaniesByNormalizedKey(
  normalizedKey: string,
): Promise<RegistryCompaniesResponse> {
  const k = normalizedKey.trim();
  if (!k) return { companies: [] };
  return registryFetchJson<RegistryCompaniesResponse>('companies', {
    method: 'GET',
    search: { normalized_key: k, limit: 50 },
  });
}

/** Batch fetch entity_owners by id (order preserved; max 50 ids). */
export async function fetchEntityOwnersByIds(ids: string[]): Promise<RegistryEntityOwnersResponse> {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 50);
  if (uniq.length === 0) {
    return { entity_owners: [] };
  }
  return registryFetchJson<RegistryEntityOwnersResponse>('entity-owners', {
    method: 'GET',
    search: { ids: uniq.join(',') },
  });
}

export async function fetchEntityOwnersByCluster(
  stateEntityId: string,
  ownerNormalizedKey: string,
): Promise<RegistryEntityOwnersResponse> {
  return registryFetchJson<RegistryEntityOwnersResponse>('entity-owners', {
    method: 'GET',
    search: { state_entity_id: stateEntityId, owner_normalized_key: ownerNormalizedKey, limit: 50 },
  });
}

export async function fetchManualEntityOwners(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  is_current?: boolean;
  has_owner_normalized_key?: boolean;
  state_entity_id?: string;
  sort_by?: string;
  sort_direction?: 'asc' | 'desc';
}): Promise<ManualEntityOwnersListResponse> {
  const q = params?.q?.trim();
  const stateEntityId = params?.state_entity_id?.trim();
  const response = await registryFetchJson<ManualEntityOwnersListResponse>('entity-owners', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      is_current: params?.is_current == null ? undefined : String(params.is_current),
      has_owner_normalized_key:
        params?.has_owner_normalized_key == null ? undefined : String(params.has_owner_normalized_key),
      state_entity_id: stateEntityId || undefined,
      sort_by: params?.sort_by,
      sort_direction: params?.sort_direction,
    },
  });
  return {
    entity_owners: Array.isArray(response.entity_owners) ? response.entity_owners : [],
    limit: coerceNonNegativeInt(response.limit, params?.limit ?? 0),
    offset: coerceNonNegativeInt(response.offset, params?.offset ?? 0),
    total_count: coerceNonNegativeInt(response.total_count, 0),
  };
}

export async function fetchIngestionRuns(params?: {
  limit?: number;
  offset?: number;
}): Promise<IngestionRunsListResponse> {
  return registryFetchJson<IngestionRunsListResponse>('ingestion-runs', {
    method: 'GET',
    search:
      params?.limit != null || params?.offset != null
        ? { limit: params.limit, offset: params.offset }
        : undefined,
  });
}

export async function fetchIngestionRun(runId: string): Promise<IngestionRunDetailResponse> {
  return registryFetchJson<IngestionRunDetailResponse>(`ingestion-runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
  });
}

export type IngestionRecordsFilter = 'all' | 'unresolved' | 'missing_website' | 'missing_phone' | 'warning_only';

export async function fetchIngestionRunRecords(
  runId: string,
  params?: { limit?: number; offset?: number; filter?: IngestionRecordsFilter },
): Promise<IngestionRunRecordsResponse> {
  return registryFetchJson<IngestionRunRecordsResponse>(`ingestion-runs/${encodeURIComponent(runId)}/records`, {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      filter: params?.filter && params.filter !== 'all' ? params.filter : undefined,
    },
  });
}

const INGESTION_RECORDS_PAGE_LIMIT = 500;

export interface CollectLinkedCompanyIdsResult {
  companyIds: string[];
  scannedRows: number;
  linkedRows: number;
  unlinkedRows: number;
}

/** Pages through all records in an ingestion run and returns distinct linked company UUIDs. */
export async function collectLinkedCompanyIdsFromIngestionRun(
  runId: string,
): Promise<CollectLinkedCompanyIdsResult> {
  const idSet = new Set<string>();
  let scannedRows = 0;
  let linkedRows = 0;
  let offset = 0;

  for (;;) {
    const res = await fetchIngestionRunRecords(runId, {
      limit: INGESTION_RECORDS_PAGE_LIMIT,
      offset,
      filter: 'all',
    });
    const { records, limit } = res;
    scannedRows += records.length;
    for (const r of records) {
      const cid = r.linked_company_id;
      if (cid) {
        linkedRows += 1;
        idSet.add(cid);
      }
    }
    if (records.length < limit) break;
    offset += limit;
  }

  return {
    companyIds: [...idSet],
    scannedRows,
    linkedRows,
    unlinkedRows: scannedRows - linkedRows,
  };
}

export async function postGoogleMapsImport(body: PostGoogleMapsImportBody): Promise<PostGoogleMapsImportResponse> {
  return registryFetchJson<PostGoogleMapsImportResponse>('imports/google-maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      importName: body.importName,
      notes: body.notes,
      sourceName: body.sourceName ?? 'google_maps',
      importWarnings: body.importWarnings,
      columnMap: body.columnMap,
      rows: body.rows,
      ...(body.costPerRowCents != null && Number.isFinite(body.costPerRowCents)
        ? { costPerRowCents: Math.trunc(body.costPerRowCents) }
        : {}),
    }),
  });
}

export async function fetchCurrentCostRate(params: {
  cost_kind: 'acquisition' | 'enrichment';
  provider: string;
  product: string;
}): Promise<CostRateCardCurrentResponse> {
  return registryFetchJson<CostRateCardCurrentResponse>('cost-rate-cards', {
    method: 'GET',
    search: {
      cost_kind: params.cost_kind,
      provider: params.provider,
      product: params.product,
    },
  });
}

export async function fetchCostRateCardsList(): Promise<CostRateCardsListResponse> {
  return registryFetchJson<CostRateCardsListResponse>('cost-rate-cards', { method: 'GET' });
}

export async function postCostRateCard(body: {
  cost_kind: 'acquisition' | 'enrichment';
  provider: string;
  product: string;
  unit_price_cents: number;
  usage_unit?: string;
  unit_quantity?: number;
  currency?: string;
  notes?: string;
  retire_previous?: boolean;
}): Promise<{ id: string }> {
  return registryFetchJson<{ id: string }>('cost-rate-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchSourceRecordDetail(recordId: string): Promise<SourceRecordDetailResponse> {
  return registryFetchJson<SourceRecordDetailResponse>(`source-records/${encodeURIComponent(recordId)}`, {
    method: 'GET',
  });
}

export async function postNormalizeIngestionRun(
  runId: string,
  body?: { limit?: number },
): Promise<NormalizeRunRecordsResponse> {
  return registryFetchJson<NormalizeRunRecordsResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/normalize-records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export async function postGenerateSourceCandidates(recordId: string): Promise<GenerateCandidatesResponse> {
  return registryFetchJson<GenerateCandidatesResponse>(
    `source-records/${encodeURIComponent(recordId)}/candidates/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
}

export async function postLinkSourceRecord(
  recordId: string,
  body: { companyId?: string; createNew?: boolean },
): Promise<Record<string, unknown>> {
  return registryFetchJson(`source-records/${encodeURIComponent(recordId)}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postRejectSourceCandidates(recordId: string): Promise<{ ok: boolean }> {
  return registryFetchJson(`source-records/${encodeURIComponent(recordId)}/reject-candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function postBulkResolution(body: {
  sourceBusinessRecordIds: string[];
  maxRecords?: number;
}): Promise<{ results: { recordId: string; outcome: string; detail?: string }[] }> {
  return registryFetchJson('resolution/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchCompanyDetail(companyId: string): Promise<ParsedCompanyDetail> {
  const body = await registryFetchJson<unknown>(`companies/${encodeURIComponent(companyId)}`, {
    method: 'GET',
  });
  return parseCompanyDetailResponse(body);
}

export async function fetchCompanyOwnershipChains(
  companyId: string,
  params?: { maxDepth?: number; maxChains?: number },
): Promise<CompanyOwnershipChainsResponse> {
  const body = await registryFetchJson<unknown>(
    `companies/${encodeURIComponent(companyId)}/ownership-chains`,
    {
      method: 'GET',
      search: {
        max_depth: params?.maxDepth,
        max_chains: params?.maxChains,
      },
    },
  );
  return parseCompanyOwnershipChainsResponse(body);
}

export async function fetchReviewTasks(params?: {
  status?: string;
  task_type?: string;
  limit?: number;
}): Promise<ReviewTasksListResponse> {
  return registryFetchJson<ReviewTasksListResponse>('review-tasks', {
    method: 'GET',
    search: { status: params?.status, task_type: params?.task_type, limit: params?.limit },
  });
}

export async function postReviewTaskResolve(
  taskId: string,
  body: {
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
    contact_enrichment_action?: 'accept_candidate' | 'reject' | 'suppress';
    chosen_candidate_index?: number;
  },
): Promise<{ ok: boolean }> {
  return registryFetchJson(`review-tasks/${encodeURIComponent(taskId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postStateMatchingPreflight(companyIds: string[]): Promise<StateMatchingPreflightResponse> {
  return registryFetchJson<StateMatchingPreflightResponse>('state-matching/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIds }),
  });
}

export type PostStateMatchingBatchResponse = {
  jobId: string;
  reconciliation_run_id: string;
  executionArn: string;
  reused: boolean;
  preflight: unknown;
  /** How many companies were routed to each runner (from preflight-ready set only). */
  bucket_counts?: { utah: number; florida: number; iowa: number };
};

export async function postStateMatchingBatch(
  companyIds: string[],
  options?: { sourceIngestionRunId?: string },
): Promise<PostStateMatchingBatchResponse> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to load registry data.');
  }
  const res = await fetch(registryUrl('state-matching/batches'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      companyIds,
      ...(options?.sourceIngestionRunId
        ? { sourceIngestionRunId: options.sourceIngestionRunId }
        : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    unsupported?: { company_id: string; state: string }[];
  } & PostStateMatchingBatchResponse;
  if (!res.ok) {
    let msg = body.error || `Registry request failed (${res.status})`;
    if (Array.isArray(body.unsupported) && body.unsupported.length > 0) {
      msg = `${msg} ${JSON.stringify(body.unsupported)}`;
    }
    throw new Error(msg);
  }
  return body;
}

export async function postImportScopedStateMatching(
  runId: string,
): Promise<PostStateMatchingBatchResponse> {
  return registryFetchJson<PostStateMatchingBatchResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/state-matching`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
}

export async function postImportScopedWebsiteVerification(
  runId: string,
): Promise<PostStartWebsiteVerificationJobResponse> {
  return registryFetchJson<PostStartWebsiteVerificationJobResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/website-verification`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
}

export async function postImportScopedGoogleAdsVerification(
  runId: string,
): Promise<PostStartGoogleAdsVerificationJobResponse> {
  return registryFetchJson<PostStartGoogleAdsVerificationJobResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/google-ads-verification`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
}

export async function fetchStateMatchingBatch(runId: string): Promise<{
  run: Record<string, unknown>;
  results: Record<string, unknown>[];
}> {
  return registryFetchJson(`state-matching/batches/${encodeURIComponent(runId)}`, {
    method: 'GET',
  });
}

export async function postStartNormalizeIngestionJob(
  runId: string,
  body?: { batchSize?: number },
): Promise<PostStartNormalizeJobResponse> {
  return registryFetchJson<PostStartNormalizeJobResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/jobs/normalize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export async function postStartAutolinkIngestionJob(
  runId: string,
  body?: { batchSize?: number },
): Promise<PostStartAutolinkJobResponse> {
  return registryFetchJson<PostStartAutolinkJobResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/jobs/autolink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export async function postContactEnrichmentPreflight(
  runId: string,
  body?: ContactEnrichmentPreflightOptions,
): Promise<ContactEnrichmentPreflightResponse> {
  return registryFetchJson<ContactEnrichmentPreflightResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/contact-enrichment/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export async function postStartContactEnrichmentIngestionJob(
  runId: string,
  body?: ContactEnrichmentPreflightOptions,
): Promise<PostStartContactEnrichmentJobResponse> {
  return registryFetchJson<PostStartContactEnrichmentJobResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/jobs/contact-enrichment`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export async function fetchIngestionRunPipelineJobs(
  runId: string,
): Promise<IngestionRunPipelineJobsResponse> {
  return registryFetchJson<IngestionRunPipelineJobsResponse>(
    `ingestion-runs/${encodeURIComponent(runId)}/pipeline-jobs`,
    {
      method: 'GET',
    },
  );
}

export async function fetchFoundryJob(jobId: string): Promise<FoundryJobDetailResponse> {
  return registryFetchJson<FoundryJobDetailResponse>(`jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
  });
}

export async function fetchFoundryJobs(params?: {
  status?: string;
  limit?: number;
}): Promise<FoundryJobsListResponse> {
  return registryFetchJson<FoundryJobsListResponse>('jobs', {
    method: 'GET',
    search: { status: params?.status, limit: params?.limit },
  });
}

function encodeCsvBuilderFilters(filters?: CsvBuilderFilter[]): string | undefined {
  if (!Array.isArray(filters) || filters.length === 0) return undefined;
  return JSON.stringify(filters);
}

export async function fetchCsvBuilderRuns(params: {
  account_id: string;
  limit?: number;
  offset?: number;
}): Promise<CsvBuilderRunsListResponse> {
  return registryFetchJson<CsvBuilderRunsListResponse>('csv-builder/runs', {
    method: 'GET',
    search: {
      account_id: params.account_id,
      limit: params.limit,
      offset: params.offset,
    },
  });
}

export async function fetchCsvBuilderRun(runId: string): Promise<CsvBuilderRunDetailResponse> {
  return registryFetchJson<CsvBuilderRunDetailResponse>(`csv-builder/runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
  });
}

export async function createCsvBuilderRun(
  body: PostCreateCsvBuilderRunBody & { account_id: string },
): Promise<PostCreateCsvBuilderRunResponse> {
  return registryFetchJson<PostCreateCsvBuilderRunResponse>('csv-builder/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchCsvBuilderColumns(runId: string): Promise<CsvBuilderColumnsResponse> {
  return registryFetchJson<CsvBuilderColumnsResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/columns`, {
    method: 'GET',
  });
}

export async function fetchCsvBuilderToolJobs(runId: string): Promise<CsvBuilderToolJobsResponse> {
  return registryFetchJson<CsvBuilderToolJobsResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/tool-jobs`, {
    method: 'GET',
  });
}

export async function fetchCsvBuilderRows(
  runId: string,
  query: CsvBuilderRowsQuery,
): Promise<CsvBuilderRowsResponse> {
  const search: Record<string, string | number | undefined | null> = {
    limit: query.limit,
    offset: query.offset,
    sort_by: query.sortBy,
    sort_direction: query.sortDirection,
    filters: encodeCsvBuilderFilters(query.filters),
  };
  for (const columnKey of query.columnKeys ?? []) {
    if (!columnKey?.trim()) continue;
    const existing = search.column_key;
    search.column_key = existing ? `${existing},${columnKey}` : columnKey;
  }
  return registryFetchJson<CsvBuilderRowsResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/rows`, {
    method: 'GET',
    search,
  });
}

export async function createCsvBuilderColumn(
  runId: string,
  body: PostCreateCsvBuilderColumnBody,
): Promise<PostCreateCsvBuilderColumnResponse> {
  return registryFetchJson<PostCreateCsvBuilderColumnResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function createCsvBuilderToolJob(
  runId: string,
  body: PostCreateCsvBuilderToolJobBody,
): Promise<PostCreateCsvBuilderToolJobResponse> {
  return registryFetchJson<PostCreateCsvBuilderToolJobResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/tool-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function rerunCsvBuilderColumn(
  columnId: string,
  body?: PostRerunCsvBuilderColumnBody,
): Promise<PostRerunCsvBuilderColumnResponse> {
  return registryFetchJson<PostRerunCsvBuilderColumnResponse>(`csv-builder/columns/${encodeURIComponent(columnId)}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export async function rerunCsvBuilderToolJob(
  jobId: string,
  body?: PostRerunCsvBuilderToolJobBody,
): Promise<PostRerunCsvBuilderToolJobResponse> {
  return registryFetchJson<PostRerunCsvBuilderToolJobResponse>(`csv-builder/tool-jobs/${encodeURIComponent(jobId)}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export async function postCsvBuilderExport(
  runId: string,
  body?: PostCsvBuilderExportBody,
): Promise<PostCsvBuilderExportResponse> {
  return registryFetchJson<PostCsvBuilderExportResponse>(`csv-builder/runs/${encodeURIComponent(runId)}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export type ExportCompanyOwnerLeadsParams = {
  limit?: number;
  offset?: number;
  q?: string;
  legal_name_q?: string;
  has_legal_name?: boolean;
  registry_state?: string | string[];
  is_export_ready?: boolean;
  has_current_linked_source?: boolean;
  has_open_review_task?: boolean;
  has_parse_failure_task?: boolean;
  has_current_owner?: boolean;
  has_website?: boolean;
  has_listing_phone?: boolean;
  has_company_notes?: boolean;
  has_normalized_key?: boolean;
  address_state?: string;
  address_city?: string;
  address_postal_code?: string;
  primary_location_state?: string;
  primary_location_city?: string;
  owner_title_q?: string;
  google_ads_result?: 'yes' | 'no' | 'unknown';
  /** When true, API adds matched contact emails/phones (latest enrichment per owner). */
  include_contact?: boolean;
  /** When true (and include_contact), adds score/tier/reason columns. Ignored if include_contact is false. */
  include_contact_confidence?: boolean;
  /** When true, API adds per-row acquisition/enrichment cost columns (USD cents). */
  include_cost?: boolean;
  /** When true, API adds latest Google Ads verification columns (company-scoped). */
  include_google_ads_verification?: boolean;
};

export type ExportCompanyChainPeopleParams = ExportCompanyOwnerLeadsParams & {
  max_depth?: number;
  max_chains?: number;
};

export type ExportCompanySummaryParams = Omit<ExportCompanyOwnerLeadsParams, 'owner_title_q' | 'include_contact' | 'include_contact_confidence'>;

export async function fetchExportCompanyOwnerLeads(
  params?: ExportCompanyOwnerLeadsParams,
): Promise<ExportCompanyOwnerLeadsResponse> {
  const q = params?.q?.trim();
  const legalNameQ = params?.legal_name_q?.trim();
  const ownerTitleQ = params?.owner_title_q?.trim();
  const registryState = Array.isArray(params?.registry_state)
    ? params.registry_state.map((value) => value.trim()).filter(Boolean)
    : params?.registry_state?.trim();
  return registryFetchJson<ExportCompanyOwnerLeadsResponse>('export/company-owner-leads', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      legal_name_q: legalNameQ || undefined,
      has_legal_name: params?.has_legal_name == null ? undefined : String(params.has_legal_name),
      registry_state: Array.isArray(registryState) ? (registryState.length > 0 ? registryState : undefined) : registryState || undefined,
      is_export_ready: params?.is_export_ready == null ? undefined : String(params.is_export_ready),
      has_current_linked_source:
        params?.has_current_linked_source == null ? undefined : String(params.has_current_linked_source),
      has_open_review_task:
        params?.has_open_review_task == null ? undefined : String(params.has_open_review_task),
      has_parse_failure_task:
        params?.has_parse_failure_task == null ? undefined : String(params.has_parse_failure_task),
      has_current_owner: params?.has_current_owner == null ? undefined : String(params.has_current_owner),
      has_website: params?.has_website == null ? undefined : String(params.has_website),
      has_listing_phone: params?.has_listing_phone == null ? undefined : String(params.has_listing_phone),
      has_company_notes: params?.has_company_notes == null ? undefined : String(params.has_company_notes),
      has_normalized_key: params?.has_normalized_key == null ? undefined : String(params.has_normalized_key),
      address_state: params?.address_state?.trim() || undefined,
      address_city: params?.address_city?.trim() || undefined,
      address_postal_code: params?.address_postal_code?.trim() || undefined,
      primary_location_state: params?.primary_location_state?.trim() || undefined,
      primary_location_city: params?.primary_location_city?.trim() || undefined,
      owner_title_q: ownerTitleQ || undefined,
      google_ads_result: params?.google_ads_result,
      include_contact: params?.include_contact === true ? 'true' : undefined,
      include_contact_confidence: params?.include_contact_confidence === true ? 'true' : undefined,
      include_cost: params?.include_cost === true ? 'true' : undefined,
      include_google_ads_verification:
        params?.include_google_ads_verification === true ? 'true' : undefined,
    },
  });
}

export async function fetchExportCompanyChainPeople(
  params?: ExportCompanyChainPeopleParams,
): Promise<ExportCompanyChainPeopleResponse> {
  const q = params?.q?.trim();
  const legalNameQ = params?.legal_name_q?.trim();
  const ownerTitleQ = params?.owner_title_q?.trim();
  const registryState = Array.isArray(params?.registry_state)
    ? params.registry_state.map((value) => value.trim()).filter(Boolean)
    : params?.registry_state?.trim();
  return registryFetchJson<ExportCompanyChainPeopleResponse>('export/company-chain-people', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      legal_name_q: legalNameQ || undefined,
      has_legal_name: params?.has_legal_name == null ? undefined : String(params.has_legal_name),
      registry_state: Array.isArray(registryState) ? (registryState.length > 0 ? registryState : undefined) : registryState || undefined,
      is_export_ready: params?.is_export_ready == null ? undefined : String(params.is_export_ready),
      has_current_linked_source:
        params?.has_current_linked_source == null ? undefined : String(params.has_current_linked_source),
      has_open_review_task:
        params?.has_open_review_task == null ? undefined : String(params.has_open_review_task),
      has_parse_failure_task:
        params?.has_parse_failure_task == null ? undefined : String(params.has_parse_failure_task),
      has_current_owner: params?.has_current_owner == null ? undefined : String(params.has_current_owner),
      has_website: params?.has_website == null ? undefined : String(params.has_website),
      has_listing_phone: params?.has_listing_phone == null ? undefined : String(params.has_listing_phone),
      has_company_notes: params?.has_company_notes == null ? undefined : String(params.has_company_notes),
      has_normalized_key: params?.has_normalized_key == null ? undefined : String(params.has_normalized_key),
      address_state: params?.address_state?.trim() || undefined,
      address_city: params?.address_city?.trim() || undefined,
      address_postal_code: params?.address_postal_code?.trim() || undefined,
      primary_location_state: params?.primary_location_state?.trim() || undefined,
      primary_location_city: params?.primary_location_city?.trim() || undefined,
      owner_title_q: ownerTitleQ || undefined,
      google_ads_result: params?.google_ads_result,
      max_depth: params?.max_depth,
      max_chains: params?.max_chains,
      include_contact: params?.include_contact === true ? 'true' : undefined,
      include_contact_confidence: params?.include_contact_confidence === true ? 'true' : undefined,
      include_cost: params?.include_cost === true ? 'true' : undefined,
      include_google_ads_verification:
        params?.include_google_ads_verification === true ? 'true' : undefined,
    },
  });
}

export async function fetchExportCompanySummary(
  params?: ExportCompanySummaryParams,
): Promise<ExportCompanySummaryResponse> {
  const q = params?.q?.trim();
  const legalNameQ = params?.legal_name_q?.trim();
  const registryState = Array.isArray(params?.registry_state)
    ? params.registry_state.map((value) => value.trim()).filter(Boolean)
    : params?.registry_state?.trim();
  return registryFetchJson<ExportCompanySummaryResponse>('export/company-summary', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      legal_name_q: legalNameQ || undefined,
      has_legal_name: params?.has_legal_name == null ? undefined : String(params.has_legal_name),
      registry_state: Array.isArray(registryState) ? (registryState.length > 0 ? registryState : undefined) : registryState || undefined,
      is_export_ready: params?.is_export_ready == null ? undefined : String(params.is_export_ready),
      has_current_linked_source:
        params?.has_current_linked_source == null ? undefined : String(params.has_current_linked_source),
      has_open_review_task:
        params?.has_open_review_task == null ? undefined : String(params.has_open_review_task),
      has_parse_failure_task:
        params?.has_parse_failure_task == null ? undefined : String(params.has_parse_failure_task),
      has_current_owner: params?.has_current_owner == null ? undefined : String(params.has_current_owner),
      has_website: params?.has_website == null ? undefined : String(params.has_website),
      has_listing_phone: params?.has_listing_phone == null ? undefined : String(params.has_listing_phone),
      has_company_notes: params?.has_company_notes == null ? undefined : String(params.has_company_notes),
      has_normalized_key: params?.has_normalized_key == null ? undefined : String(params.has_normalized_key),
      address_state: params?.address_state?.trim() || undefined,
      address_city: params?.address_city?.trim() || undefined,
      address_postal_code: params?.address_postal_code?.trim() || undefined,
      primary_location_state: params?.primary_location_state?.trim() || undefined,
      primary_location_city: params?.primary_location_city?.trim() || undefined,
      google_ads_result: params?.google_ads_result,
      include_cost: params?.include_cost === true ? 'true' : undefined,
      include_google_ads_verification:
        params?.include_google_ads_verification === true ? 'true' : undefined,
    },
  });
}

const MAX_EXPORT_CSV_ROWS = 20000;

/** Pages through export leads with the same filters until exhausted or cap reached. */
export async function collectExportCompanyOwnerLeadsForCsv(
  params: Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'>,
): Promise<{ rows: ExportCompanyOwnerLeadsResponse['rows']; truncated: boolean; total_count: number }> {
  const pageSize = 100;
  const all: ExportCompanyOwnerLeadsResponse['rows'] = [];
  let offset = 0;
  let total_count = 0;

  for (;;) {
    const res = await fetchExportCompanyOwnerLeads({
      ...params,
      limit: pageSize,
      offset,
    });
    total_count = res.total_count;
    all.push(...res.rows);

    if (all.length > MAX_EXPORT_CSV_ROWS) {
      return {
        rows: all.slice(0, MAX_EXPORT_CSV_ROWS),
        truncated: true,
        total_count,
      };
    }

    if (res.rows.length < pageSize || all.length >= total_count) {
      return { rows: all, truncated: false, total_count };
    }
    offset += pageSize;
  }
}

/** Pages through chain-linked export rows by target page until exhausted or cap reached. */
export async function collectExportCompanyChainPeopleForCsv(
  params: Omit<ExportCompanyChainPeopleParams, 'limit' | 'offset'>,
): Promise<{ rows: ExportCompanyChainPeopleResponse['rows']; truncated: boolean; total_count: number }> {
  const pageSize = 100;
  const all: ExportCompanyChainPeopleResponse['rows'] = [];
  let offset = 0;
  let total_count = 0;

  for (;;) {
    const res = await fetchExportCompanyChainPeople({
      ...params,
      limit: pageSize,
      offset,
    });
    total_count = res.total_count;
    all.push(...res.rows);

    if (all.length > MAX_EXPORT_CSV_ROWS) {
      return {
        rows: all.slice(0, MAX_EXPORT_CSV_ROWS),
        truncated: true,
        total_count,
      };
    }

    if (res.targets_returned < pageSize || offset + res.targets_returned >= total_count) {
      return { rows: all, truncated: false, total_count };
    }
    offset += pageSize;
  }
}

export async function collectExportCompanySummaryForCsv(
  params: Omit<ExportCompanySummaryParams, 'limit' | 'offset'>,
): Promise<{ rows: ExportCompanySummaryResponse['rows']; truncated: boolean; total_count: number }> {
  const pageSize = 100;
  const all: ExportCompanySummaryResponse['rows'] = [];
  let offset = 0;
  let total_count = 0;

  for (;;) {
    const res = await fetchExportCompanySummary({
      ...params,
      limit: pageSize,
      offset,
    });
    total_count = res.total_count;
    all.push(...res.rows);

    if (all.length > MAX_EXPORT_CSV_ROWS) {
      return {
        rows: all.slice(0, MAX_EXPORT_CSV_ROWS),
        truncated: true,
        total_count,
      };
    }

    if (res.rows.length < pageSize || all.length >= total_count) {
      return { rows: all, truncated: false, total_count };
    }
    offset += pageSize;
  }
}

export async function postCompanyMerge(body: {
  survivor_company_id: string;
  other_company_ids: string[];
  merged?: { legal_name?: string; notes?: string | null };
  review_task_id?: string;
}): Promise<CompanyMergeResponse> {
  return registryFetchJson<CompanyMergeResponse>('companies/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postEntityOwnerMerge(body: {
  survivor_entity_owner_id: string;
  other_entity_owner_ids: string[];
  merged?: {
    owner_name?: string;
    title_role?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  review_task_id?: string;
}): Promise<EntityOwnerMergeResponse> {
  return registryFetchJson<EntityOwnerMergeResponse>('entity-owners/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postEntityOwnerDeletePreflight(
  entityOwnerId: string,
): Promise<EntityOwnerDeletePreflightResponse> {
  return registryFetchJson<EntityOwnerDeletePreflightResponse>('entity-owners/delete-preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_owner_id: entityOwnerId }),
  });
}

export async function postEntityOwnerDelete(body: {
  entity_owner_id: string;
  force_cascade?: boolean;
  confirmation_token?: string;
}): Promise<{ ok: boolean }> {
  return registryFetchJson<{ ok: boolean }>('entity-owners/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postCompanyDeletePreflight(companyId: string): Promise<CompanyDeletePreflightResponse> {
  return registryFetchJson<CompanyDeletePreflightResponse>('companies/delete-preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId }),
  });
}

export async function postCompanyDelete(body: {
  company_id: string;
  force_cascade?: boolean;
  confirmation_token?: string;
}): Promise<{ ok: boolean }> {
  return registryFetchJson<{ ok: boolean }>('companies/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchSourceRecordsList(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  ingestion_run_id?: string;
}): Promise<SourceRecordsListResponse> {
  const q = params?.q?.trim();
  return registryFetchJson<SourceRecordsListResponse>('source-records', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      ingestion_run_id: params?.ingestion_run_id?.trim() || undefined,
    },
  });
}

export async function postSourceRecordsMerge(body: {
  survivor_source_business_record_id: string;
  other_source_business_record_ids: string[];
  merged?: { name_raw?: string; website?: string | null; address_raw?: string | null };
}): Promise<SourceRecordsMergeResponse> {
  return registryFetchJson<SourceRecordsMergeResponse>('source-records/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postSourceRecordDeletePreflight(
  sourceBusinessRecordId: string,
): Promise<SourceRecordDeletePreflightResponse> {
  return registryFetchJson<SourceRecordDeletePreflightResponse>('source-records/delete-preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_business_record_id: sourceBusinessRecordId }),
  });
}

export async function postSourceRecordDelete(body: {
  source_business_record_id: string;
  force_cascade?: boolean;
  confirmation_token?: string;
}): Promise<{ ok: boolean }> {
  return registryFetchJson<{ ok: boolean }>('source-records/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
