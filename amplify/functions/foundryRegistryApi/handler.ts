/**
 * Foundry registry Lambda (separate Supabase "leads/registry" project).
 *
 * Routes (append to Function URL base):
 * - GET /companies?limit=50&q=substring (optional q: ilike legal_name, min 2 chars, limit capped at 50)
 * - GET /companies?ids=uuid,uuid (batch by id, max 50; order matches request)
 * - GET /companies?normalized_key=key (all companies sharing key, max 50)
 * - GET /entity-owners?ids=... | ?state_entity_id=&owner_normalized_key=
 * - POST /entity-owners/merge, /entity-owners/delete-preflight, /entity-owners/delete
 * - GET /ingestion-runs?limit=
 * - GET /ingestion-runs/:id
 * - GET /ingestion-runs/:id/records?limit=&offset=&filter= (records include linked_company_id when link_status is linked)
 * - POST /imports/google-maps
 * - GET /source-records/:id
 * - POST /ingestion-runs/:id/normalize-records
 * - POST /ingestion-runs/:id/jobs/normalize
 * - GET /jobs, GET /jobs/:id
 * - POST /source-records/:id/candidates/generate | /link | /reject-candidates
 * - POST /resolution/bulk
 * - GET|PATCH /companies/:id (GET includes associated_people from entity_owners via current matches), POST /companies/:id/locations, POST /companies (create)
 * - GET /export/company-owner-leads?limit=&offset=&q=&registry_state=&is_export_ready=&has_current_linked_source=&has_open_review_task=&has_parse_failure_task=&has_current_owner=&include_contact=&include_contact_confidence=
 * - GET /export/company-chain-people?...&max_depth=&max_chains=&include_contact=&include_contact_confidence=
 * - GET /review-tasks, GET /review-tasks/:id, PATCH .../assign, POST .../resolve|cancel
 * - POST /state-matching/preflight, POST /state-matching/batches (async job + Step Functions), GET /state-matching/batches/:id
 * - GET /reconciliation/runs/:id
 *
 * Headers: Authorization: Bearer <supabase_access_token>
 *
 * Writes use the leads Supabase service role after Foundry access checks.
 *
 * Entity resolution (candidates, link, bulk resolve) lives in @furnace/registry-server (entityResolution).
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  classifyAllRows,
  summarizeClassification,
  type ColumnMap,
  type ClassifiedRow,
} from './validateImport';
import { dispatchFoundryExtendedRoutes } from './foundryApiRoutes.js';
import { handleFoundryJobsRequest, startNormalizeIngestionJob } from './foundryJobsApi.js';

const FOUNDRY_FLAG_KEY = 'foundry';
const MAX_COMPANIES_LIMIT = 100;
const DEFAULT_COMPANIES_LIMIT = 50;
const MAX_COMPANIES_SEARCH_LIMIT = 50;
const MAX_INGESTION_RUNS_LIMIT = 100;
const DEFAULT_INGESTION_RUNS_LIMIT = 50;
const MAX_IMPORT_ROWS = 8000;
const INSERT_BATCH_SIZE = 250;
const PARSER_VERSION = 'gm_csv_v1';
const INGEST_VERSION = 'foundry_import_v1';
const SOURCE_NAME = 'google_maps';
const SOURCE_TYPE = 'google_maps';

interface FunctionUrlEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string };
  };
}

interface FunctionUrlResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

function response(
  statusCode: number,
  body?: string,
  headers?: Record<string, string>,
  isBase64Encoded?: boolean,
): FunctionUrlResponse {
  const res: FunctionUrlResponse = { statusCode };
  if (headers) res.headers = headers;
  if (body !== undefined) res.body = body;
  if (isBase64Encoded) res.isBase64Encoded = true;
  return res;
}

function jsonResponse(statusCode: number, data: object): FunctionUrlResponse {
  return response(statusCode, JSON.stringify(data), {
    'Content-Type': 'application/json',
  });
}

function getAuthHeader(event: FunctionUrlEvent): string | null {
  const auth = event.headers?.['authorization'] || event.headers?.['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function normalizePath(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/';
  return rawPath.replace(/\/+$/, '') || '/';
}

function parseLimit(rawQueryString: string, max: number, defaultVal: number): number {
  const params = new URLSearchParams(rawQueryString || '');
  const raw = params.get('limit');
  if (raw == null || raw === '') return defaultVal;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

function parseOffset(rawQueryString: string): number {
  const params = new URLSearchParams(rawQueryString || '');
  const raw = params.get('offset');
  if (raw == null || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Escape % and _ so user input is literal inside ILIKE patterns. */
function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function parseTriStateBool(v: string | null): boolean | undefined {
  if (v == null || v === '') return undefined;
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return undefined;
}

function parseCompaniesListQuery(rawQueryString: string): {
  limit: number;
  offset: number;
  q: string | null;
  hasNormalizedKey: boolean | undefined;
  hasNotes: boolean | undefined;
  sortBy: 'legal_name' | 'notes' | 'updated_at';
  sortDirection: 'asc' | 'desc';
} {
  const params = new URLSearchParams(rawQueryString || '');
  const baseLimit = parseLimit(rawQueryString, MAX_COMPANIES_LIMIT, DEFAULT_COMPANIES_LIMIT);
  const offset = parseOffset(rawQueryString);
  const rawQ = params.get('q');
  const trimmed = rawQ != null ? rawQ.trim() : '';
  const q = trimmed.length >= 2 ? trimmed : null;
  const limit = q ? Math.min(baseLimit, MAX_COMPANIES_SEARCH_LIMIT) : baseLimit;
  return {
    limit,
    offset,
    q,
    hasNormalizedKey: parseTriStateBool(params.get('has_normalized_key')),
    hasNotes: parseTriStateBool(params.get('has_notes')),
    sortBy:
      params.get('sort_by') === 'name'
        ? 'legal_name'
        : params.get('sort_by') === 'notes'
          ? 'notes'
          : 'updated_at',
    sortDirection: params.get('sort_direction') === 'asc' ? 'asc' : 'desc',
  };
}

async function verifyUser(
  supabase: SupabaseClient,
  token: string,
): Promise<{ user: User } | { error: FunctionUrlResponse }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { error: jsonResponse(401, { error: 'Invalid or expired token' }) };
  }
  return { user };
}

async function assertFoundryAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<FunctionUrlResponse | null> {
  const { data, error } = await supabase
    .from('user_access_flags')
    .select('user_id')
    .eq('user_id', userId)
    .eq('flag_key', FOUNDRY_FLAG_KEY)
    .maybeSingle();

  if (error) {
    console.error('user_access_flags query failed', error.message);
    return jsonResponse(500, { error: 'Failed to verify access' });
  }
  if (!data) {
    return jsonResponse(403, { error: 'Foundry access denied' });
  }
  return null;
}

function decodeBody(event: FunctionUrlEvent): string {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseJsonBody<T>(raw: string): { ok: true; value: T } | { ok: false; response: FunctionUrlResponse } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'Invalid JSON body' }) };
  }
}

interface GoogleMapsImportBody {
  importName: string;
  notes?: string;
  sourceName?: string;
  importWarnings: boolean;
  columnMap: ColumnMap;
  rows: Record<string, string>[];
}

function rowShouldImport(r: ClassifiedRow, importWarnings: boolean): boolean {
  if (r.status === 'error') return false;
  if (r.status === 'warning' && !importWarnings) return false;
  return true;
}

type ImportPipelineNormalize =
  | { status: 'started'; jobId: string; executionArn: string; reused: boolean }
  | { status: 'failed'; error: string; detail?: string; code?: string }
  | { status: 'skipped_no_rows' };

async function handleGoogleMapsImport(
  leadsClient: SupabaseClient,
  body: GoogleMapsImportBody,
  userId: string,
): Promise<FunctionUrlResponse> {
  const importName = typeof body.importName === 'string' ? body.importName.trim() : '';
  if (!importName) {
    return jsonResponse(400, { error: 'importName is required' });
  }
  const columnMap = body.columnMap;
  if (
    !columnMap ||
    typeof columnMap.nameRawHeader !== 'string' ||
    typeof columnMap.addressRawHeader !== 'string'
  ) {
    return jsonResponse(400, { error: 'columnMap with nameRawHeader and addressRawHeader is required' });
  }
  if (!Array.isArray(body.rows)) {
    return jsonResponse(400, { error: 'rows must be an array' });
  }
  if (body.rows.length > MAX_IMPORT_ROWS) {
    return jsonResponse(400, { error: `At most ${MAX_IMPORT_ROWS} rows per import` });
  }
  const importWarnings = Boolean(body.importWarnings);
  const sourceName = body.sourceName === 'google_maps' || !body.sourceName ? SOURCE_NAME : String(body.sourceName);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  const classified = classifyAllRows(body.rows, {
    nameRawHeader: columnMap.nameRawHeader,
    addressRawHeader: columnMap.addressRawHeader,
    websiteHeader: columnMap.websiteHeader ?? null,
  });
  const summary = summarizeClassification(classified);

  const toInsert = classified.filter((r) => rowShouldImport(r, importWarnings));
  const skippedRows = classified.length - toInsert.length;

  const config = {
    import_name: importName,
    notes: notes || undefined,
    source_type: SOURCE_TYPE,
    import_warnings: importWarnings,
    column_map: {
      name_raw: columnMap.nameRawHeader,
      address_raw: columnMap.addressRawHeader,
      website: columnMap.websiteHeader ?? undefined,
    },
    parser_version: PARSER_VERSION,
    ingest_version: INGEST_VERSION,
  };

  const initialStats = {
    total_rows: summary.totalRows,
    valid_rows: summary.validRows,
    warning_rows: summary.warningRows,
    error_rows: summary.errorRows,
    imported_rows: 0,
    skipped_rows: skippedRows,
    failed_rows: 0,
  };

  const { data: runRow, error: runErr } = await leadsClient
    .from('ingestion_runs')
    .insert({
      source_name: sourceName,
      source_type: SOURCE_TYPE,
      status: 'running',
      config,
      stats: initialStats,
      parser_version: PARSER_VERSION,
      ingest_version: INGEST_VERSION,
    })
    .select('id')
    .single();

  if (runErr || !runRow) {
    console.error('ingestion_runs insert failed', runErr?.message);
    return jsonResponse(502, { error: 'Failed to create ingestion run' });
  }

  const runId = runRow.id as string;
  let imported = 0;
  let failed = 0;

  try {
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + INSERT_BATCH_SIZE);
      const payload = chunk.map((r) => ({
        ingestion_run_id: runId,
        source_name: sourceName,
        source_record_id: String(r.rowNumber),
        name_raw: r.nameRaw,
        address_raw: r.addressRaw || null,
        website: r.websiteRaw,
        raw_payload: {
          ...r.rawRow,
          __rowNumber: r.rowNumber,
          __import_validation: r.status,
          __import_issues: r.issues,
        } as Record<string, unknown>,
      }));

      const { error: insErr } = await leadsClient.from('source_business_records').insert(payload);
      if (insErr) {
        console.error('source_business_records batch insert failed', insErr.message);
        failed += chunk.length;
      } else {
        imported += chunk.length;
      }
    }
  } catch (e) {
    console.error('import exception', e);
    await leadsClient
      .from('ingestion_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        stats: {
          ...initialStats,
          imported_rows: imported,
          failed_rows: failed + (toInsert.length - imported - failed),
          skipped_rows: skippedRows,
        },
        error_summary: 'Import failed during insert',
      })
      .eq('id', runId);
    return jsonResponse(502, { error: 'Import failed during database insert', runId });
  }

  const finalStats = {
    ...initialStats,
    imported_rows: imported,
    failed_rows: failed,
    skipped_rows: skippedRows,
  };

  const terminalStatus =
    toInsert.length > 0 && imported === 0 ? 'failed' : 'completed';
  const { error: updErr } = await leadsClient
    .from('ingestion_runs')
    .update({
      status: terminalStatus,
      completed_at: new Date().toISOString(),
      stats: finalStats,
      error_summary:
        failed > 0
          ? `${failed} row(s) failed to insert`
          : imported === 0 && toInsert.length > 0
            ? 'No rows imported'
            : null,
    })
    .eq('id', runId);

  if (updErr) {
    console.error('ingestion_runs finalize failed', updErr.message);
  }

  const errorSamples = classified
    .filter((r) => r.status === 'error')
    .slice(0, 25)
    .map((r) => ({
      rowNumber: r.rowNumber,
      issues: r.issues,
      nameRaw: r.nameRaw,
      addressRaw: r.addressRaw,
    }));

  let pipelineNormalize: ImportPipelineNormalize = { status: 'skipped_no_rows' };

  if (terminalStatus === 'completed' && imported > 0) {
    const norm = await startNormalizeIngestionJob(leadsClient, runId, userId);
    if (norm.status === 'started') {
      pipelineNormalize = {
        status: 'started',
        jobId: norm.jobId,
        executionArn: norm.executionArn,
        reused: norm.reused,
      };
    } else {
      pipelineNormalize = {
        status: 'failed',
        error: norm.error,
        ...(norm.detail ? { detail: norm.detail } : {}),
        ...(norm.code ? { code: norm.code } : {}),
      };
    }
  }

  return jsonResponse(200, {
    runId,
    stats: finalStats,
    errorSamples,
    parserVersion: PARSER_VERSION,
    ingestVersion: INGEST_VERSION,
    pipeline: { normalize: pipelineNormalize },
  });
}

export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResponse> => {
  const method = event.requestContext?.http?.method ?? 'GET';
  if (event.headers?.['access-control-request-method'] || method === 'OPTIONS') {
    return response(204, '');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const leadsUrl = process.env.LEADS_SUPABASE_URL;
  const leadsSecretKey = process.env.LEADS_SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return jsonResponse(500, { error: 'Server configuration error' });
  }
  if (!leadsUrl || !leadsSecretKey) {
    console.error('Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY');
    return jsonResponse(500, { error: 'Server configuration error' });
  }

  const token = getAuthHeader(event);
  if (!token) {
    return jsonResponse(401, { error: 'Missing or invalid Authorization header' });
  }

  const mainClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const verified = await verifyUser(mainClient, token);
  if ('error' in verified) return verified.error;

  const forbidden = await assertFoundryAccess(mainClient, verified.user.id);
  if (forbidden) return forbidden;

  const leadsClient = createClient(leadsUrl, leadsSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const path = normalizePath(event.rawPath || '/');

  if (path === '/companies') {
    if (method === 'GET') {
      const listParams = new URLSearchParams(event.rawQueryString || '');
      const idsRaw = listParams.get('ids')?.trim();
      if (idsRaw) {
        const parts = idsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const unique = [...new Set(parts)].filter((id) => UUID_RE.test(id)).slice(0, 50);
        if (unique.length === 0) {
          return jsonResponse(400, { error: 'ids must include at least one valid UUID' });
        }
        const { data, error } = await leadsClient
          .from('companies')
          .select('id, legal_name, normalized_key, notes, created_at, updated_at')
          .in('id', unique);
        if (error) {
          console.error('companies batch select failed', error.message);
          return jsonResponse(502, { error: 'Failed to load registry data' });
        }
        const byId = new Map((data ?? []).map((row) => [row.id as string, row]));
        const ordered = unique.map((id) => byId.get(id)).filter(Boolean);
        return jsonResponse(200, { companies: ordered });
      }

      const nk = listParams.get('normalized_key')?.trim();
      if (nk) {
        const limitNk = Math.min(parseLimit(event.rawQueryString || '', MAX_COMPANIES_LIMIT, 50), 50);
        const { data, error } = await leadsClient
          .from('companies')
          .select('id, legal_name, normalized_key, notes, created_at, updated_at')
          .eq('normalized_key', nk)
          .order('id', { ascending: true })
          .limit(limitNk);
        if (error) {
          console.error('companies by normalized_key failed', error.message);
          return jsonResponse(502, { error: 'Failed to load registry data' });
        }
        return jsonResponse(200, { companies: data ?? [] });
      }

      const { limit, offset, q, hasNormalizedKey, hasNotes, sortBy, sortDirection } = parseCompaniesListQuery(event.rawQueryString || '');
      let qb = leadsClient
        .from('companies')
        .select('id, legal_name, normalized_key, notes, created_at, updated_at', { count: 'exact' });
      if (q) {
        qb = qb.ilike('legal_name', `%${escapeIlikePattern(q)}%`);
      }
      if (hasNormalizedKey === true) qb = qb.not('normalized_key', 'is', null);
      else if (hasNormalizedKey === false) qb = qb.is('normalized_key', null);
      if (hasNotes === true) qb = qb.not('notes', 'is', null);
      else if (hasNotes === false) qb = qb.is('notes', null);
      const end = offset + limit - 1;
      let ordered = qb.order(sortBy, { ascending: sortDirection === 'asc', nullsFirst: sortDirection !== 'asc' });
      if (sortBy !== 'updated_at') {
        ordered = ordered.order('updated_at', { ascending: false });
      }
      const { data, error, count } = await ordered.range(offset, end);

      if (error) {
        console.error('companies select failed', error.message);
        return jsonResponse(502, { error: 'Failed to load registry data' });
      }
      // Manual dedupe tables rely on this count for server-side pagination.
      return jsonResponse(200, {
        companies: data ?? [],
        limit,
        offset,
        total_count: count ?? 0,
      });
    }
    if (method === 'POST') {
      const raw = decodeBody(event);
      const parsed = parseJsonBody<{ legal_name: string; normalized_key?: string; notes?: string }>(raw);
      if (!parsed.ok) return parsed.response;
      const legal = typeof parsed.value.legal_name === 'string' ? parsed.value.legal_name.trim() : '';
      if (!legal) return jsonResponse(400, { error: 'legal_name is required' });
      const { data, error } = await leadsClient
        .from('companies')
        .insert({
          legal_name: legal,
          normalized_key: parsed.value.normalized_key ?? null,
          notes: parsed.value.notes ?? null,
        })
        .select('id, legal_name, normalized_key, notes, created_at, updated_at')
        .single();
      if (error) return jsonResponse(400, { error: error.message });
      return jsonResponse(200, { company: data });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (path === '/ingestion-runs') {
    if (method === 'GET') {
      const limit = parseLimit(
        event.rawQueryString || '',
        MAX_INGESTION_RUNS_LIMIT,
        DEFAULT_INGESTION_RUNS_LIMIT,
      );
      const offset = parseOffset(event.rawQueryString || '');
      const { data, error, count } = await leadsClient
        .from('ingestion_runs')
        .select(
          'id, source_name, source_type, status, started_at, completed_at, config, stats, created_at, parser_version, ingest_version',
          { count: 'exact' },
        )
        .order('started_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('ingestion_runs list failed', error.message);
        return jsonResponse(502, { error: 'Failed to load ingestion runs' });
      }
      return jsonResponse(200, { runs: data ?? [], limit, offset, total_count: count ?? 0 });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const runDetailMatch = path.match(/^\/ingestion-runs\/([^/]+)$/);
  if (runDetailMatch) {
    const id = runDetailMatch[1];
    if (!UUID_RE.test(id)) {
      return jsonResponse(400, { error: 'Invalid run id' });
    }
    if (method === 'GET') {
      const { data, error } = await leadsClient
        .from('ingestion_runs')
        .select(
          'id, source_name, source_type, status, started_at, completed_at, config, stats, error_summary, created_at, parser_version, ingest_version',
        )
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('ingestion_runs get failed', error.message);
        return jsonResponse(502, { error: 'Failed to load ingestion run' });
      }
      if (!data) {
        return jsonResponse(404, { error: 'Ingestion run not found' });
      }
      return jsonResponse(200, { run: data });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const runRecordsMatch = path.match(/^\/ingestion-runs\/([^/]+)\/records$/);
  if (runRecordsMatch) {
    const id = runRecordsMatch[1];
    if (!UUID_RE.test(id)) {
      return jsonResponse(400, { error: 'Invalid run id' });
    }
    if (method === 'GET') {
      const limit = parseLimit(event.rawQueryString || '', 500, 100);
      const offset = parseOffset(event.rawQueryString || '');
      const params = new URLSearchParams(event.rawQueryString || '');
      const filter = params.get('filter') || 'all';

      const enrichRecords = async (
        list: Array<Record<string, unknown>>,
      ): Promise<{
        rows: Array<Record<string, unknown>>;
        unresolvedRows: Array<Record<string, unknown>>;
      }> => {
        const ids = list.map((r) => r.id as string);
        const linkStatusByRecord = new Map<string, string>();
        const linkedCompanyByRecord = new Map<string, string>();
        if (ids.length > 0) {
          const { data: links } = await leadsClient
            .from('source_business_company_links')
            .select('source_business_record_id, link_status, company_id')
            .in('source_business_record_id', ids)
            .eq('is_current', true);

          const byRid = new Map<string, Set<string>>();
          for (const row of links ?? []) {
            const rid = row.source_business_record_id as string;
            const st = row.link_status as string;
            if (!byRid.has(rid)) byRid.set(rid, new Set());
            byRid.get(rid)!.add(st);
            if (st === 'linked' && row.company_id) {
              linkedCompanyByRecord.set(rid, String(row.company_id));
            }
          }
          for (const [rid, set] of byRid) {
            if (set.has('linked')) linkStatusByRecord.set(rid, 'linked');
            else if (set.has('candidate')) linkStatusByRecord.set(rid, 'candidate');
            else linkStatusByRecord.set(rid, [...set][0] ?? 'none');
          }
        }

        const rows = list.map((r) => {
        const payload = (r.raw_payload ?? {}) as Record<string, unknown>;
        const validation = typeof payload.__import_validation === 'string' ? payload.__import_validation : null;
        const linkStatus = linkStatusByRecord.get(r.id as string) ?? 'none';
        const linked_company_id =
          linkStatus === 'linked' ? (linkedCompanyByRecord.get(r.id as string) ?? null) : null;
        const sourceRowNumber = typeof payload.__rowNumber === 'number' ? payload.__rowNumber : null;
        const resMeta = (r as { resolution_meta?: Record<string, unknown> }).resolution_meta ?? {};
        const normalized_name_key =
          typeof resMeta.normalized_name_key === 'string' ? resMeta.normalized_name_key : null;
        return {
          id: r.id,
          name_raw: r.name_raw,
          website: r.website,
          address_raw: r.address_raw,
          observed_at: r.observed_at,
          ingestion_run_id: r.ingestion_run_id,
          link_status: linkStatus,
          import_validation: validation,
          review_status: '—' as const,
          source_row_number: sourceRowNumber,
          normalized_name_key,
          inferred_state_region:
            typeof resMeta.inferred_state_region === 'string' ? resMeta.inferred_state_region : null,
          linked_company_id,
        };
        });

        return {
          rows,
          unresolvedRows: rows.filter((row) => row.link_status !== 'linked'),
        };
      };

      if (filter === 'unresolved') {
        const batchSize = Math.max(limit, 250);
        let scanOffset = 0;
        let totalUnresolved = 0;
        let pageRows: Array<Record<string, unknown>> = [];

        for (;;) {
          const { data: batch, error: batchErr } = await leadsClient
            .from('source_business_records')
            .select('id, name_raw, website, address_raw, observed_at, ingestion_run_id, raw_payload, resolution_meta')
            .eq('ingestion_run_id', id)
            .order('created_at', { ascending: true })
            .range(scanOffset, scanOffset + batchSize - 1);

          if (batchErr) {
            console.error('source_business_records unresolved list failed', batchErr.message);
            return jsonResponse(502, { error: 'Failed to load records' });
          }

          const list = batch ?? [];
          const enriched = await enrichRecords(list as Array<Record<string, unknown>>);
          const unresolvedBatch = enriched.unresolvedRows;
          const nextTotal = totalUnresolved + unresolvedBatch.length;

          if (offset < nextTotal && pageRows.length < limit) {
            const startIndex = Math.max(0, offset - totalUnresolved);
            pageRows = pageRows.concat(unresolvedBatch.slice(startIndex, startIndex + (limit - pageRows.length)));
          }

          totalUnresolved = nextTotal;
          if (list.length < batchSize) {
            return jsonResponse(200, {
              records: pageRows,
              limit,
              offset,
              total_count: totalUnresolved,
            });
          }
          scanOffset += batchSize;
        }
      }

      let q = leadsClient
        .from('source_business_records')
        .select('id, name_raw, website, address_raw, observed_at, ingestion_run_id, raw_payload, resolution_meta', {
          count: 'exact',
        })
        .eq('ingestion_run_id', id)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (filter === 'missing_website') {
        q = q.or('website.is.null,website.eq.""');
      }
      if (filter === 'warning_only') {
        q = q.contains('raw_payload', { __import_validation: 'warning' });
      }

      const { data: records, error: recErr, count } = await q;
      if (recErr) {
        console.error('source_business_records list failed', recErr.message);
        return jsonResponse(502, { error: 'Failed to load records' });
      }

      const enriched = await enrichRecords((records ?? []) as Array<Record<string, unknown>>);

      return jsonResponse(200, { records: enriched.rows, limit, offset, total_count: count ?? 0 });
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const jobsBody = decodeBody(event);
  const jobsResponse = await handleFoundryJobsRequest(
    leadsClient,
    method,
    path,
    jobsBody,
    event.rawQueryString || '',
    verified.user.id,
  );
  if (jobsResponse) return jobsResponse;

  const extended = await dispatchFoundryExtendedRoutes(
    leadsClient,
    method,
    path,
    jobsBody,
    event.rawQueryString || '',
    verified.user.id,
    leadsSecretKey,
  );
  if (extended) return extended;

  if (path === '/imports/google-maps') {
    if (method === 'POST') {
      const raw = decodeBody(event);
      const parsed = parseJsonBody<GoogleMapsImportBody>(raw);
      if (!parsed.ok) return parsed.response;
      return handleGoogleMapsImport(leadsClient, parsed.value, verified.user.id);
    }
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  return jsonResponse(404, { error: 'Not found' });
};
