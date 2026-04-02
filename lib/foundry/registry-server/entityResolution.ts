import type { SupabaseClient } from '@supabase/supabase-js';
import { buildResolutionMeta } from './normalizeSourceRecord.js';
import { ensureCompanyDedupeReviewTaskForNormalizedKey } from './companyDedupe.js';

export const LINKER_VERSION = 'foundry_linker_v1';

const DEFAULT_AUTO_RESOLVE_PAGE = 40;

interface SourceRecordDetailCompanyRow {
  id: string;
  legal_name: string;
  normalized_key: string | null;
  primary_address_line: string | null;
  linked_source_websites: string[];
}

/** One display line from a company_locations row (matches adjudication / company profile needs). */
function formatLocationLine(loc: {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
}): string {
  const parts = [loc.line1, loc.line2, loc.city, loc.state_region, loc.postal_code]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

export async function getSourceRecordDetail(leadsClient: SupabaseClient, id: string) {
  const { data: rec, error } = await leadsClient
    .from('source_business_records')
    .select(
      'id, ingestion_run_id, source_name, name_raw, website, address_raw, raw_payload, resolution_meta, observed_at, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rec) return null;

  const { data: links } = await leadsClient
    .from('source_business_company_links')
    .select('id, company_id, link_status, link_score, linker_version, is_current, created_at')
    .eq('source_business_record_id', id)
    .order('created_at', { ascending: false });

  const companyIds = [...new Set((links ?? []).filter((l) => l.is_current).map((l) => l.company_id as string))];
  let companies: Record<string, SourceRecordDetailCompanyRow> = {};
  if (companyIds.length > 0) {
    const { data: cos } = await leadsClient
      .from('companies')
      .select('id, legal_name, normalized_key')
      .in('id', companyIds);
    for (const c of cos ?? []) {
      const id = c.id as string;
      companies[id] = {
        id,
        legal_name: c.legal_name as string,
        normalized_key: (c.normalized_key as string | null) ?? null,
        primary_address_line: null,
        linked_source_websites: [],
      };
    }

    const { data: locRows } = await leadsClient
      .from('company_locations')
      .select('company_id, line1, line2, city, state_region, postal_code, is_primary')
      .in('company_id', companyIds);

    const locsByCompany = new Map<
      string,
      {
        company_id: string;
        line1: string | null;
        line2: string | null;
        city: string | null;
        state_region: string | null;
        postal_code: string | null;
        is_primary: boolean;
      }[]
    >();
    for (const row of locRows ?? []) {
      const cid = row.company_id as string;
      const arr = locsByCompany.get(cid) ?? [];
      arr.push({
        company_id: cid,
        line1: (row.line1 as string | null) ?? null,
        line2: (row.line2 as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        state_region: (row.state_region as string | null) ?? null,
        postal_code: (row.postal_code as string | null) ?? null,
        is_primary: row.is_primary === true,
      });
      locsByCompany.set(cid, arr);
    }
    for (const cid of companyIds) {
      const rows = locsByCompany.get(cid) ?? [];
      const primary = rows.find((r) => r.is_primary === true) ?? rows[0];
      let addr: string | null = null;
      if (primary) {
        const line = formatLocationLine({
          line1: primary.line1 as string | null,
          line2: primary.line2 as string | null,
          city: primary.city as string | null,
          state_region: primary.state_region as string | null,
          postal_code: primary.postal_code as string | null,
        });
        addr = line.length > 0 ? line : null;
      }
      if (companies[cid]) companies[cid].primary_address_line = addr;
    }

    const { data: coLinks } = await leadsClient
      .from('source_business_company_links')
      .select('company_id, source_business_record_id, created_at')
      .in('company_id', companyIds)
      .eq('is_current', true)
      .order('created_at', { ascending: false });

    const recordOrderByCompany = new Map<string, string[]>();
    for (const link of coLinks ?? []) {
      const cid = link.company_id as string;
      const rid = link.source_business_record_id as string;
      if (!rid) continue;
      const arr = recordOrderByCompany.get(cid) ?? [];
      arr.push(rid);
      recordOrderByCompany.set(cid, arr);
    }

    const allRids = [
      ...new Set((coLinks ?? []).map((l) => l.source_business_record_id as string).filter(Boolean)),
    ];
    const idToWebsite = new Map<string, string | null>();
    if (allRids.length > 0) {
      const { data: srcRecs } = await leadsClient
        .from('source_business_records')
        .select('id, website')
        .in('id', allRids);
      for (const r of srcRecs ?? []) {
        idToWebsite.set(r.id as string, (r.website as string | null) ?? null);
      }
    }

    for (const cid of companyIds) {
      const order = recordOrderByCompany.get(cid) ?? [];
      const seen = new Set<string>();
      const urls: string[] = [];
      for (const rid of order) {
        const w = idToWebsite.get(rid);
        const trimmed = typeof w === 'string' ? w.trim() : '';
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          urls.push(trimmed);
        }
      }
      if (companies[cid]) companies[cid].linked_source_websites = urls;
    }
  }

  return { record: rec, links: links ?? [], companiesById: companies };
}

function nameSimilarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.88;
  let same = 0;
  const short = x.length < y.length ? x : y;
  const long = x.length < y.length ? y : x;
  for (let i = 0; i < short.length; i++) {
    if (long.includes(short[i]!)) same++;
  }
  return Math.min(0.85, 0.5 + same / (2 * long.length));
}

export async function generateCandidatesForSourceRecord(leadsClient: SupabaseClient, recordId: string) {
  const detail = await getSourceRecordDetail(leadsClient, recordId);
  if (!detail) return { error: 'not_found' as const };
  const meta = detail.record.resolution_meta as Record<string, unknown> | null;
  const nameKey = typeof meta?.normalized_name_key === 'string' ? meta.normalized_name_key : null;
  if (!nameKey) {
    return { error: 'normalize_first' as const, message: 'Run normalization for this record first' };
  }

  const { data: byKey } = await leadsClient
    .from('companies')
    .select('id, legal_name, normalized_key')
    .eq('normalized_key', nameKey)
    .limit(25);

  const nameRaw = detail.record.name_raw as string;
  const safeFragment = nameRaw.replace(/[%_\\]/g, '').slice(0, 80);
  const { data: byName } = safeFragment
    ? await leadsClient
        .from('companies')
        .select('id, legal_name, normalized_key')
        .ilike('legal_name', `%${safeFragment}%`)
        .limit(25)
    : { data: [] as { id: string; legal_name: string; normalized_key: string | null }[] };

  const merged = new Map<string, { id: string; legal_name: string; normalized_key: string | null; score: number }>();
  for (const c of [...(byKey ?? []), ...(byName ?? [])]) {
    const id = c.id as string;
    const sk = nameSimilarity(nameRaw, c.legal_name as string);
    const keyBoost = c.normalized_key === nameKey ? 0.15 : 0;
    const score = Math.min(1, sk + keyBoost);
    const prev = merged.get(id);
    if (!prev || prev.score < score) {
      merged.set(id, {
        id,
        legal_name: c.legal_name as string,
        normalized_key: c.normalized_key as string | null,
        score,
      });
    }
  }

  const candidates = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 15);

  const { data: existing } = await leadsClient
    .from('source_business_company_links')
    .select('id, company_id, link_status, is_current')
    .eq('source_business_record_id', recordId)
    .eq('is_current', true);

  const hasLinked = (existing ?? []).some((l) => l.link_status === 'linked');

  const inserted: string[] = [];
  if (!hasLinked) {
    await leadsClient
      .from('source_business_company_links')
      .update({ is_current: false })
      .eq('source_business_record_id', recordId)
      .eq('is_current', true)
      .eq('link_status', 'candidate');

    for (const cand of candidates) {
      const { data: ins, error } = await leadsClient
        .from('source_business_company_links')
        .insert({
          source_business_record_id: recordId,
          company_id: cand.id,
          link_status: 'candidate',
          link_score: cand.score,
          linker_version: LINKER_VERSION,
          is_current: true,
        })
        .select('id')
        .single();
      if (!error && ins) inserted.push(ins.id as string);
    }
  }

  return { candidates, inserted_link_ids: inserted, skipped_existing_linked: hasLinked };
}

async function clearCurrentLinksForRecord(leadsClient: SupabaseClient, recordId: string) {
  await leadsClient
    .from('source_business_company_links')
    .update({ is_current: false })
    .eq('source_business_record_id', recordId)
    .eq('is_current', true);
}

export async function linkSourceToCompany(
  leadsClient: SupabaseClient,
  recordId: string,
  body: { companyId?: string; createNew?: boolean },
) {
  const detail = await getSourceRecordDetail(leadsClient, recordId);
  if (!detail) return { error: 'not_found' as const };

  let companyId = body.companyId;
  if (body.createNew) {
    const meta = buildResolutionMeta({
      name_raw: detail.record.name_raw as string,
      website: detail.record.website as string | null,
      address_raw: detail.record.address_raw as string | null,
    });
    const { data: co, error } = await leadsClient
      .from('companies')
      .insert({
        legal_name: (detail.record.name_raw as string).trim().slice(0, 500),
        normalized_key: meta.normalized_name_key,
        notes: 'created_from_source',
      })
      .select('id')
      .single();
    if (error || !co) return { error: 'company_create_failed' as const, message: error?.message };
    companyId = co.id as string;

    try {
      await ensureCompanyDedupeReviewTaskForNormalizedKey(leadsClient, meta.normalized_name_key);
    } catch (e) {
      console.error('ensureCompanyDedupeReviewTaskForNormalizedKey failed', e);
    }

    const state = meta.inferred_state_region;
    if (state || detail.record.address_raw) {
      await leadsClient.from('company_locations').insert({
        company_id: companyId,
        line1: (detail.record.address_raw as string | null)?.slice(0, 300) ?? null,
        state_region: state,
        is_primary: true,
      });
    }
  }

  if (!companyId) return { error: 'company_required' as const };

  await clearCurrentLinksForRecord(leadsClient, recordId);
  const { data: link, error: lerr } = await leadsClient
    .from('source_business_company_links')
    .insert({
      source_business_record_id: recordId,
      company_id: companyId,
      link_status: 'linked',
      link_score: 1,
      linker_version: LINKER_VERSION,
      is_current: true,
    })
    .select('id')
    .single();
  if (lerr) return { error: 'link_failed' as const, message: lerr.message };

  await leadsClient
    .from('review_tasks')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution: {
        via: 'source_link_endpoint',
        company_id: companyId,
        linker_version: LINKER_VERSION,
      },
    })
    .eq('task_type', 'source_link_review')
    .eq('entity_type', 'source_business_record')
    .eq('entity_id', recordId)
    .eq('status', 'pending');

  return { link_id: link?.id, company_id: companyId };
}

export async function rejectCandidatesForSource(leadsClient: SupabaseClient, recordId: string) {
  await leadsClient
    .from('source_business_company_links')
    .update({ link_status: 'rejected', is_current: false })
    .eq('source_business_record_id', recordId)
    .eq('is_current', true)
    .eq('link_status', 'candidate');
  return { ok: true as const };
}

const AUTO_LINK_MIN_SCORE = 0.92;
const REVIEW_TASK_THRESHOLD_LOW = 0.55;

export async function autoResolveSourceRecord(leadsClient: SupabaseClient, recordId: string) {
  const norm = await getSourceRecordDetail(leadsClient, recordId);
  if (!norm) return { outcome: 'error' as const, message: 'not_found' };
  const meta = norm.record.resolution_meta as Record<string, unknown> | null;
  if (!meta?.normalized_name_key) {
    await leadsClient
      .from('source_business_records')
      .update({
        resolution_meta: buildResolutionMeta({
          name_raw: norm.record.name_raw as string,
          website: norm.record.website as string | null,
          address_raw: norm.record.address_raw as string | null,
        }) as unknown as Record<string, unknown>,
      })
      .eq('id', recordId);
  }

  const candResult = await generateCandidatesForSourceRecord(leadsClient, recordId);
  if ('error' in candResult && candResult.error === 'not_found') {
    return { outcome: 'error' as const, message: 'not_found' };
  }
  if ('error' in candResult && candResult.error === 'normalize_first') {
    return { outcome: 'error' as const, message: candResult.message };
  }

  const { data: linked } = await leadsClient
    .from('source_business_company_links')
    .select('id')
    .eq('source_business_record_id', recordId)
    .eq('is_current', true)
    .eq('link_status', 'linked')
    .maybeSingle();
  if (linked) return { outcome: 'skipped' as const, reason: 'already_linked' };

  const { data: cands } = await leadsClient
    .from('source_business_company_links')
    .select('company_id, link_score, link_status')
    .eq('source_business_record_id', recordId)
    .eq('is_current', true)
    .eq('link_status', 'candidate')
    .order('link_score', { ascending: false });

  const top = cands ?? [];
  if (top.length === 0) {
    const r = await linkSourceToCompany(leadsClient, recordId, { createNew: true });
    if ('error' in r) return { outcome: 'error' as const, message: r.message ?? r.error };
    return { outcome: 'created_company_and_linked' as const, company_id: r.company_id };
  }

  const best = top[0]!;
  const second = top[1];
  const bestScore = Number(best.link_score);
  const secondScore = second ? Number(second.link_score) : 0;
  if (bestScore >= AUTO_LINK_MIN_SCORE && bestScore - secondScore >= 0.08) {
    await clearCurrentLinksForRecord(leadsClient, recordId);
    const ins = await leadsClient
      .from('source_business_company_links')
      .insert({
        source_business_record_id: recordId,
        company_id: best.company_id as string,
        link_status: 'linked',
        link_score: bestScore,
        linker_version: LINKER_VERSION,
        is_current: true,
      })
      .select('id')
      .single();
    if (ins.error) return { outcome: 'error' as const, message: ins.error.message };
    return { outcome: 'auto_linked' as const, company_id: best.company_id };
  }

  if (bestScore < REVIEW_TASK_THRESHOLD_LOW) {
    const r = await linkSourceToCompany(leadsClient, recordId, { createNew: true });
    if ('error' in r) return { outcome: 'error' as const, message: r.message ?? r.error };
    return { outcome: 'created_company_and_linked' as const, company_id: r.company_id };
  }

  await leadsClient.from('review_tasks').insert({
    task_type: 'source_link_review',
    entity_type: 'source_business_record',
    entity_id: recordId,
    status: 'pending',
    priority: 0,
    payload: {
      candidate_company_ids: top.map((t) => t.company_id),
      scores: top.map((t) => ({ company_id: t.company_id, score: t.link_score })),
      linker_version: LINKER_VERSION,
    },
  });

  return { outcome: 'review_task_created' as const };
}

export async function bulkAutoResolve(
  leadsClient: SupabaseClient,
  recordIds: string[],
  maxN: number,
): Promise<{ results: { recordId: string; outcome: string; detail?: string }[] }> {
  const slice = recordIds.slice(0, maxN);
  const results: { recordId: string; outcome: string; detail?: string }[] = [];
  for (const recordId of slice) {
    try {
      const r = await autoResolveSourceRecord(leadsClient, recordId);
      results.push({
        recordId,
        outcome: r.outcome,
        detail: 'message' in r ? (r as { message?: string }).message : undefined,
      });
    } catch (e) {
      results.push({
        recordId,
        outcome: 'error',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { results };
}

/**
 * Keyset page of source_business_records.id for an ingestion run (ascending id).
 * Used by async auto-resolve after normalize.
 */
export async function listSourceRecordIdsPageForIngestionRun(
  leadsClient: SupabaseClient,
  ingestionRunId: string,
  batchSize: number,
  cursor: string | null,
): Promise<{ ids: string[]; nextCursor: string | null; done: boolean }> {
  const n = Math.min(200, Math.max(1, batchSize || DEFAULT_AUTO_RESOLVE_PAGE));
  let q = leadsClient
    .from('source_business_records')
    .select('id')
    .eq('ingestion_run_id', ingestionRunId)
    .order('id', { ascending: true })
    .limit(n);

  if (cursor) {
    q = q.gt('id', cursor);
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const list = rows ?? [];
  if (list.length === 0) {
    return { ids: [], nextCursor: null, done: true };
  }
  const lastId = list[list.length - 1]!.id as string;
  const hasMore = list.length === n;
  return {
    ids: list.map((r) => r.id as string),
    nextCursor: hasMore ? lastId : null,
    done: !hasMore,
  };
}
