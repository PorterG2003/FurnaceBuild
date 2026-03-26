import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bulkAutoResolve,
  companyDeleteImpactFingerprint,
  entityOwnerDeleteImpactFingerprint,
  generateCandidatesForSourceRecord,
  getSourceRecordDetail,
  isCompanyDeleteSafe,
  isEntityOwnerDeleteSafe,
  isSourceRecordDeleteSafe,
  linkSourceToCompany,
  loadCompanyDeleteImpact,
  loadEntityOwnerDeleteImpact,
  loadSourceRecordDeleteImpact,
  mergeCompanies,
  mergeEntityOwners,
  mergeSourceBusinessRecords,
  normalizeIngestionRunRecords,
  rejectCandidatesForSource,
} from '@furnace/registry-server';
import {
  bucketCompaniesForMatching,
  getReviewTask,
  listReviewTasks,
  resolveReviewTask,
  stateMatchingPreflight,
} from './foundryLayer2.js';

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

const MAX_EXPORT_LEADS_LIMIT = 100;
const DEFAULT_EXPORT_LEADS_LIMIT = 50;

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

export async function dispatchFoundryExtendedRoutes(
  leadsClient: SupabaseClient,
  method: string,
  path: string,
  rawBody: string,
  rawQueryString: string,
  actorUserId: string,
  hmacSecret: string,
): Promise<FunctionUrlResponse | null> {
  if (path === '/export/company-owner-leads' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
    const limit = parseLimit(rawQueryString || '', MAX_EXPORT_LEADS_LIMIT, DEFAULT_EXPORT_LEADS_LIMIT);
    const offset = parseOffsetExport(rawQueryString || '');
    const qSearch = params.get('q')?.trim() ?? '';
    const registryState = params.get('registry_state')?.trim();

    let qb = leadsClient.from('export_company_owner_leads').select('*', { count: 'exact' });

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

    qb = qb
      .order('company_updated_at', { ascending: false })
      .order('match_updated_at', { ascending: false })
      .order('entity_owner_id', { ascending: true, nullsFirst: false });

    const end = offset + limit - 1;
    const { data, error, count } = await qb.range(offset, end);

    if (error) {
      console.error('export_company_owner_leads failed', error.message);
      return jsonResponse(502, { error: 'Failed to load export leads' });
    }

    return jsonResponse(200, {
      rows: data ?? [],
      limit,
      offset,
      total_count: count ?? 0,
    });
  }

  if (path === '/entity-owners' && method === 'GET') {
    const params = new URLSearchParams(rawQueryString || '');
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
      const limitCl = Math.min(parseLimit(rawQueryString || '', 100, 50), 50);
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

    return jsonResponse(400, { error: 'Provide ids= or state_entity_id= with owner_normalized_key=' });
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
