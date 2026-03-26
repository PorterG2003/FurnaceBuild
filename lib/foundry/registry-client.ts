import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import {
  parseCompanyDetailResponse,
  type ParsedCompanyDetail,
  type ExportCompanyOwnerLeadsResponse,
  type FoundryJobDetailResponse,
  type FoundryJobsListResponse,
  type IngestionRunDetailResponse,
  type IngestionRunRecordsResponse,
  type IngestionRunsListResponse,
  type NormalizeRunRecordsResponse,
  type PostGoogleMapsImportBody,
  type PostGoogleMapsImportResponse,
  type PostStartNormalizeJobResponse,
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

function registryUrl(path: string, search?: Record<string, string | number | undefined | null>): string {
  const base = registryBaseUrl();
  const u = new URL(path.replace(/^\//, ''), base);
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

async function registryFetchJson<T>(
  path: string,
  init: RequestInit & { search?: Record<string, string | number | undefined | null> },
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
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) || `Registry request failed (${res.status})`);
  }
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

export async function fetchIngestionRuns(params?: { limit?: number }): Promise<IngestionRunsListResponse> {
  return registryFetchJson<IngestionRunsListResponse>('ingestion-runs', {
    method: 'GET',
    search: params?.limit != null ? { limit: params.limit } : undefined,
  });
}

export async function fetchIngestionRun(runId: string): Promise<IngestionRunDetailResponse> {
  return registryFetchJson<IngestionRunDetailResponse>(`ingestion-runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
  });
}

export type IngestionRecordsFilter = 'all' | 'unresolved' | 'missing_website' | 'warning_only';

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
    }),
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
  bucket_counts?: { utah: number; florida: number };
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

export type ExportCompanyOwnerLeadsParams = {
  limit?: number;
  offset?: number;
  q?: string;
  registry_state?: string;
  is_export_ready?: boolean;
  has_current_linked_source?: boolean;
  has_open_review_task?: boolean;
  has_parse_failure_task?: boolean;
  has_current_owner?: boolean;
};

export async function fetchExportCompanyOwnerLeads(
  params?: ExportCompanyOwnerLeadsParams,
): Promise<ExportCompanyOwnerLeadsResponse> {
  const q = params?.q?.trim();
  return registryFetchJson<ExportCompanyOwnerLeadsResponse>('export/company-owner-leads', {
    method: 'GET',
    search: {
      limit: params?.limit,
      offset: params?.offset,
      q: q && q.length >= 2 ? q : undefined,
      registry_state: params?.registry_state?.trim() || undefined,
      is_export_ready: params?.is_export_ready,
      has_current_linked_source: params?.has_current_linked_source,
      has_open_review_task: params?.has_open_review_task,
      has_parse_failure_task: params?.has_parse_failure_task,
      has_current_owner: params?.has_current_owner,
    },
  });
}

const MAX_EXPORT_CSV_ROWS = 5000;

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
