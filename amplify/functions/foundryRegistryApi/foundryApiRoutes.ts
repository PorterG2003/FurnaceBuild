import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bulkAutoResolve,
  generateCandidatesForSourceRecord,
  getSourceRecordDetail,
  linkSourceToCompany,
  normalizeIngestionRunRecords,
  rejectCandidatesForSource,
} from './entityResolution.js';
import { getReviewTask, listReviewTasks, resolveReviewTask, stateMatchingPreflight } from './foundryLayer2.js';

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

function parseJsonBody<T>(raw: string): { ok: true; value: T } | { ok: false; response: FunctionUrlResponse } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'Invalid JSON body' }) };
  }
}

export async function dispatchFoundryExtendedRoutes(
  leadsClient: SupabaseClient,
  method: string,
  path: string,
  rawBody: string,
  rawQueryString: string,
  actorUserId: string,
): Promise<FunctionUrlResponse | null> {
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
    const { data: matches } = await leadsClient
      .from('company_entity_matches')
      .select('id, state_entity_id, match_status, match_score, registry_state, is_current')
      .eq('company_id', id)
      .eq('is_current', true);
    return jsonResponse(200, { company: co, locations: locs ?? [], source_links: links ?? [], entity_matches: matches ?? [] });
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
    const limit = parseLimit(rawQueryString || '', 200, 50);
    const rows = await listReviewTasks(leadsClient, { status, limit });
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
    return jsonResponse(200, pre);
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
