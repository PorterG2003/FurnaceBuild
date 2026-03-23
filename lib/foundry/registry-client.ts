import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import type {
  CompanyDetailResponse,
  FoundryJobDetailResponse,
  FoundryJobsListResponse,
  IngestionRunDetailResponse,
  IngestionRunRecordsResponse,
  IngestionRunsListResponse,
  NormalizeRunRecordsResponse,
  PostGoogleMapsImportBody,
  PostGoogleMapsImportResponse,
  PostStartNormalizeJobResponse,
  RegistryCompaniesResponse,
  ReviewTasksListResponse,
  SourceRecordDetailResponse,
  StateMatchingPreflightResponse,
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

function companiesListUrl(limit?: number): string {
  return registryUrl('companies', limit != null ? { limit } : undefined);
}

/**
 * List companies from the registry (leads) database via the Foundry Lambda.
 */
export async function fetchRegistryCompanies(params?: { limit?: number }): Promise<RegistryCompaniesResponse> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to load registry data.');
  }

  const res = await fetch(companiesListUrl(params?.limit), {
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

export async function postGenerateSourceCandidates(recordId: string): Promise<Record<string, unknown>> {
  return registryFetchJson(`source-records/${encodeURIComponent(recordId)}/candidates/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
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

export async function fetchCompanyDetail(companyId: string): Promise<CompanyDetailResponse> {
  return registryFetchJson<CompanyDetailResponse>(`companies/${encodeURIComponent(companyId)}`, {
    method: 'GET',
  });
}

export async function fetchReviewTasks(params?: { status?: string; limit?: number }): Promise<ReviewTasksListResponse> {
  return registryFetchJson<ReviewTasksListResponse>('review-tasks', {
    method: 'GET',
    search: { status: params?.status, limit: params?.limit },
  });
}

export async function postReviewTaskResolve(
  taskId: string,
  body: {
    resolution?: Record<string, unknown>;
    chosen_company_id?: string;
    chosen_match_action?: 'promote' | 'reject';
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

export async function postStateMatchingBatch(companyIds: string[]): Promise<{ run_id: string; per_company: unknown[] }> {
  return registryFetchJson('state-matching/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIds }),
  });
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
