import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNameKey } from './normalizeSourceRecord.js';

export const MERGE_LINKER_VERSION = 'foundry_company_merge_v1';
export const MERGE_MATCHER_VERSION = 'foundry_company_merge_v1';

/** Impact summary for delete preflight / cascade UI. */
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

export function isCompanyDeleteSafe(impact: CompanyDeleteImpact): boolean {
  return impact.current_linked_source_count === 0 && impact.current_promoted_match_count === 0;
}

/** Stable string for HMAC binding (tests can snapshot this shape). */
export function companyDeleteImpactFingerprint(impact: CompanyDeleteImpact): string {
  const parts = [
    `linked:${impact.current_linked_source_count}`,
    `cand_links:${impact.current_candidate_or_rejected_link_count}`,
    `promoted:${impact.current_promoted_match_count}`,
    `other_matches:${impact.current_other_match_count}`,
    `locs:${impact.location_count}`,
  ];
  return parts.join('|');
}

export async function loadCompanyDeleteImpact(
  leadsClient: SupabaseClient,
  companyId: string,
): Promise<CompanyDeleteImpact> {
  const { data: links } = await leadsClient
    .from('source_business_company_links')
    .select('id, source_business_record_id, link_status')
    .eq('company_id', companyId)
    .eq('is_current', true);

  let current_linked_source_count = 0;
  let current_candidate_or_rejected_link_count = 0;
  const sampleLinked: string[] = [];
  for (const l of links ?? []) {
    if (l.link_status === 'linked') {
      current_linked_source_count++;
      if (sampleLinked.length < 8) sampleLinked.push(l.source_business_record_id as string);
    } else {
      current_candidate_or_rejected_link_count++;
    }
  }

  const { data: matches } = await leadsClient
    .from('company_entity_matches')
    .select('id, match_status')
    .eq('company_id', companyId)
    .eq('is_current', true);

  let current_promoted_match_count = 0;
  let current_other_match_count = 0;
  const sampleMatchIds: string[] = [];
  for (const m of matches ?? []) {
    if (m.match_status === 'promoted') current_promoted_match_count++;
    else current_other_match_count++;
    if (sampleMatchIds.length < 8) sampleMatchIds.push(m.id as string);
  }

  const { data: locs } = await leadsClient.from('company_locations').select('id').eq('company_id', companyId);
  const location_count = locs?.length ?? 0;
  const sample_location_ids = (locs ?? []).slice(0, 8).map((r) => r.id as string);

  return {
    company_id: companyId,
    current_linked_source_count,
    current_candidate_or_rejected_link_count,
    current_promoted_match_count,
    current_other_match_count,
    location_count,
    sample_linked_source_record_ids: sampleLinked,
    sample_match_ids: sampleMatchIds,
    sample_location_ids,
  };
}

function locationLooselySame(
  a: { line1: string | null; state_region: string | null; city: string | null; normalized_address_key: string | null },
  b: { line1: string | null; state_region: string | null; city: string | null; normalized_address_key: string | null },
): boolean {
  if (a.normalized_address_key && b.normalized_address_key && a.normalized_address_key === b.normalized_address_key) {
    return true;
  }
  const sa = `${(a.line1 ?? '').trim().toLowerCase()}|${(a.city ?? '').trim().toLowerCase()}|${(a.state_region ?? '').trim().toLowerCase()}`;
  const sb = `${(b.line1 ?? '').trim().toLowerCase()}|${(b.city ?? '').trim().toLowerCase()}|${(b.state_region ?? '').trim().toLowerCase()}`;
  return sa.length > 3 && sa === sb;
}

async function repointLinksFromCompany(
  leadsClient: SupabaseClient,
  fromCompanyId: string,
  toCompanyId: string,
): Promise<void> {
  const { data: links } = await leadsClient
    .from('source_business_company_links')
    .select('id, source_business_record_id, link_status')
    .eq('company_id', fromCompanyId)
    .eq('is_current', true);

  for (const link of links ?? []) {
    const recordId = link.source_business_record_id as string;
    const { data: existingTo } = await leadsClient
      .from('source_business_company_links')
      .select('id, link_status')
      .eq('source_business_record_id', recordId)
      .eq('company_id', toCompanyId)
      .eq('is_current', true)
      .maybeSingle();

    if (!existingTo) {
      const { error } = await leadsClient
        .from('source_business_company_links')
        .update({ company_id: toCompanyId, linker_version: MERGE_LINKER_VERSION })
        .eq('id', link.id as string);
      if (error) throw new Error(error.message);
      continue;
    }

    const incomingLinked = link.link_status === 'linked';
    const existingLinked = existingTo.link_status === 'linked';
    const preferIncoming = incomingLinked && !existingLinked;

    if (preferIncoming) {
      await leadsClient.from('source_business_company_links').update({ is_current: false }).eq('id', existingTo.id as string);
      const { error } = await leadsClient
        .from('source_business_company_links')
        .update({ company_id: toCompanyId, linker_version: MERGE_LINKER_VERSION })
        .eq('id', link.id as string);
      if (error) throw new Error(error.message);
    } else {
      await leadsClient.from('source_business_company_links').update({ is_current: false }).eq('id', link.id as string);
    }
  }
}

async function repointMatchesFromCompany(
  leadsClient: SupabaseClient,
  fromCompanyId: string,
  toCompanyId: string,
  mergeLog: Record<string, unknown>[],
): Promise<void> {
  const { data: loserMatches } = await leadsClient
    .from('company_entity_matches')
    .select('id, match_status, registry_state, state_entity_id')
    .eq('company_id', fromCompanyId)
    .eq('is_current', true);

  for (const m of loserMatches ?? []) {
    const state = m.registry_state as string;
    const mid = m.id as string;

    const { data: survPromo } = await leadsClient
      .from('company_entity_matches')
      .select('id')
      .eq('company_id', toCompanyId)
      .eq('registry_state', state)
      .eq('is_current', true)
      .eq('match_status', 'promoted')
      .maybeSingle();

    if (m.match_status === 'promoted' && survPromo) {
      await leadsClient
        .from('company_entity_matches')
        .update({ match_status: 'rejected', is_current: false })
        .eq('id', mid);
      mergeLog.push({ match_id: mid, action: 'rejected_promoted_conflict' });
      continue;
    }

    if (m.match_status === 'promoted') {
      const { error } = await leadsClient
        .from('company_entity_matches')
        .update({ company_id: toCompanyId, matcher_version: MERGE_MATCHER_VERSION })
        .eq('id', mid);
      if (error) throw new Error(error.message);
      mergeLog.push({ match_id: mid, action: 'repointed_promoted' });
      continue;
    }

    const { data: dup } = await leadsClient
      .from('company_entity_matches')
      .select('id')
      .eq('company_id', toCompanyId)
      .eq('state_entity_id', m.state_entity_id as string)
      .eq('is_current', true)
      .maybeSingle();

    if (dup) {
      await leadsClient.from('company_entity_matches').update({ match_status: 'rejected', is_current: false }).eq('id', mid);
      mergeLog.push({ match_id: mid, action: 'rejected_duplicate_entity' });
    } else {
      const { error } = await leadsClient
        .from('company_entity_matches')
        .update({ company_id: toCompanyId, matcher_version: MERGE_MATCHER_VERSION })
        .eq('id', mid);
      if (error) throw new Error(error.message);
      mergeLog.push({ match_id: mid, action: 'repointed_match' });
    }
  }
}

async function copyLocationsFromCompany(
  leadsClient: SupabaseClient,
  fromCompanyId: string,
  toCompanyId: string,
): Promise<void> {
  const { data: surv } = await leadsClient.from('company_locations').select('*').eq('company_id', toCompanyId);
  const { data: loserLocs } = await leadsClient.from('company_locations').select('*').eq('company_id', fromCompanyId);

  const survivors = surv ?? [];
  for (const loc of loserLocs ?? []) {
    const hit = survivors.some((s) =>
      locationLooselySame(
        {
          line1: s.line1 as string | null,
          state_region: s.state_region as string | null,
          city: s.city as string | null,
          normalized_address_key: s.normalized_address_key as string | null,
        },
        {
          line1: loc.line1 as string | null,
          state_region: loc.state_region as string | null,
          city: loc.city as string | null,
          normalized_address_key: loc.normalized_address_key as string | null,
        },
      ),
    );
    if (hit) continue;

    await leadsClient.from('company_locations').insert({
      company_id: toCompanyId,
      line1: loc.line1 as string | null,
      line2: loc.line2 as string | null,
      city: loc.city as string | null,
      state_region: loc.state_region as string | null,
      postal_code: loc.postal_code as string | null,
      country: loc.country as string | null,
      is_primary: false,
      normalized_address_key: loc.normalized_address_key as string | null,
      latitude: loc.latitude as number | null,
      longitude: loc.longitude as number | null,
      source_type: loc.source_type as string | null,
      address_confidence: loc.address_confidence as number | null,
      deliverability_status: loc.deliverability_status as string | null,
      address_hash: loc.address_hash as string | null,
    });
  }
}

/**
 * When two or more companies share a normalized_key, ensure a single pending
 * `company_dedupe` review task exists with an up-to-date candidate id list.
 * Idempotent per key; updates payload if the cluster changed.
 */
export async function ensureCompanyDedupeReviewTaskForNormalizedKey(
  leadsClient: SupabaseClient,
  normalizedKey: string | null | undefined,
): Promise<void> {
  if (!normalizedKey) return;

  const { data: rows, error: qErr } = await leadsClient
    .from('companies')
    .select('id')
    .eq('normalized_key', normalizedKey)
    .order('id', { ascending: true });
  if (qErr) throw new Error(qErr.message);
  const list = rows ?? [];
  if (list.length < 2) return;

  const candidateIds = list.map((r) => r.id as string);
  const entityId = candidateIds[0]!;

  const { data: existingRows, error: exErr } = await leadsClient
    .from('review_tasks')
    .select('id, payload')
    .eq('task_type', 'company_dedupe')
    .eq('status', 'pending')
    .eq('payload->>normalized_key', normalizedKey);

  if (exErr) throw new Error(exErr.message);

  const existing = existingRows ?? [];
  if (existing.length > 0) {
    const keep = existing[0]!;
    const prev = (keep.payload as Record<string, unknown> | null) ?? {};
    const { error: upErr } = await leadsClient
      .from('review_tasks')
      .update({
        payload: {
          ...prev,
          candidate_company_ids: candidateIds,
          normalized_key: normalizedKey,
        },
        entity_id: entityId,
      })
      .eq('id', keep.id as string);
    if (upErr) throw new Error(upErr.message);

    if (existing.length > 1) {
      const dupIds = existing.slice(1).map((r) => r.id as string);
      await leadsClient.from('review_tasks').update({ status: 'cancelled' }).in('id', dupIds);
    }
    return;
  }

  const { error: insErr } = await leadsClient.from('review_tasks').insert({
    task_type: 'company_dedupe',
    entity_type: 'company',
    entity_id: entityId,
    status: 'pending',
    priority: 0,
    payload: {
      candidate_company_ids: candidateIds,
      normalized_key: normalizedKey,
    },
  });
  if (insErr) throw new Error(insErr.message);
}

export type MergeCompaniesParams = {
  survivor_company_id: string;
  other_company_ids: string[];
  merged?: { legal_name?: string; notes?: string | null };
};

export async function mergeCompanies(
  leadsClient: SupabaseClient,
  params: MergeCompaniesParams,
): Promise<{ ok: true; merge_log: Record<string, unknown>[] } | { error: string }> {
  const survivor = params.survivor_company_id;
  const losers = [...new Set(params.other_company_ids)].filter((id) => id && id !== survivor);
  if (!survivor || losers.length === 0) {
    return { error: 'survivor_company_id and at least one other_company_id required' };
  }

  const mergeSet = new Set([survivor, ...losers]);
  const { data: cos, error: coErr } = await leadsClient
    .from('companies')
    .select('id, legal_name, notes')
    .in('id', [...mergeSet]);
  if (coErr) return { error: coErr.message };
  if (!cos || cos.length !== mergeSet.size) {
    return { error: 'one or more company ids not found' };
  }

  const survRow = cos.find((c) => c.id === survivor);
  if (!survRow) return { error: 'survivor not found' };

  const legal_name =
    params.merged?.legal_name != null ? String(params.merged.legal_name).trim() : (survRow.legal_name as string);
  if (!legal_name) return { error: 'legal_name empty' };
  const notes =
    params.merged?.notes !== undefined ? params.merged.notes : ((survRow.notes as string | null) ?? null);

  const normalized_key = normalizeNameKey(legal_name);
  const { data: nkRows } = await leadsClient.from('companies').select('id').eq('normalized_key', normalized_key);
  const outsider = nkRows?.find((r) => !mergeSet.has(r.id as string));
  if (outsider) {
    return { error: 'normalized_key conflict with another company outside merge set' };
  }

  const merge_log: Record<string, unknown>[] = [];

  for (const loserId of losers) {
    await repointLinksFromCompany(leadsClient, loserId, survivor);
    await repointMatchesFromCompany(leadsClient, loserId, survivor, merge_log);
    await copyLocationsFromCompany(leadsClient, loserId, survivor);
  }

  const { error: upErr } = await leadsClient
    .from('companies')
    .update({
      legal_name,
      notes,
      normalized_key,
      updated_at: new Date().toISOString(),
    })
    .eq('id', survivor);
  if (upErr) return { error: upErr.message };

  for (const loserId of losers) {
    const { error: delErr } = await leadsClient.from('companies').delete().eq('id', loserId);
    if (delErr) return { error: delErr.message };
    merge_log.push({ deleted_company_id: loserId });
  }

  merge_log.push({ survivor_company_id: survivor, normalized_key });
  return { ok: true, merge_log };
}

export interface MergeSourceRecordsParams {
  survivor_source_business_record_id: string;
  other_source_business_record_ids: string[];
  merged?: {
    name_raw?: string;
    website?: string | null;
    address_raw?: string | null;
  };
}

/**
 * Keep one source row; repoint links from losers; delete loser rows.
 * Does not touch canonical companies except via existing link rows (same company_id preserved).
 */
export async function mergeSourceBusinessRecords(
  leadsClient: SupabaseClient,
  params: MergeSourceRecordsParams,
): Promise<{ ok: true; merge_log: Record<string, unknown>[] } | { error: string }> {
  const survivor = params.survivor_source_business_record_id;
  const losers = [...new Set(params.other_source_business_record_ids)].filter((id) => id && id !== survivor);
  if (!survivor || losers.length === 0) {
    return { error: 'survivor_source_business_record_id and at least one other id required' };
  }

  const { data: recs, error: re } = await leadsClient
    .from('source_business_records')
    .select('id, name_raw, website, address_raw')
    .in('id', [survivor, ...losers]);
  if (re) return { error: re.message };
  if (!recs || recs.length !== 1 + losers.length) return { error: 'one or more source record ids not found' };

  const surv = recs.find((r) => r.id === survivor);
  if (!surv) return { error: 'survivor record not found' };

  const name_raw = params.merged?.name_raw ?? (surv.name_raw as string);
  const website = params.merged?.website !== undefined ? params.merged.website : (surv.website as string | null);
  const address_raw =
    params.merged?.address_raw !== undefined ? params.merged.address_raw : (surv.address_raw as string | null);

  const merge_log: Record<string, unknown>[] = [];

  for (const loserId of losers) {
    const { data: loserLinks } = await leadsClient
      .from('source_business_company_links')
      .select('id, company_id, link_status')
      .eq('source_business_record_id', loserId)
      .eq('is_current', true);

    for (const link of loserLinks ?? []) {
      const companyId = link.company_id as string;
      const { data: existingSurv } = await leadsClient
        .from('source_business_company_links')
        .select('id, link_status')
        .eq('source_business_record_id', survivor)
        .eq('company_id', companyId)
        .eq('is_current', true)
        .maybeSingle();

      if (!existingSurv) {
        await leadsClient
          .from('source_business_company_links')
          .update({ source_business_record_id: survivor, linker_version: MERGE_LINKER_VERSION })
          .eq('id', link.id as string);
        merge_log.push({ link_id: link.id, action: 'repointed_to_survivor_record' });
      } else {
        const preferIncoming = link.link_status === 'linked' && existingSurv.link_status !== 'linked';
        if (preferIncoming) {
          await leadsClient.from('source_business_company_links').update({ is_current: false }).eq('id', existingSurv.id as string);
          await leadsClient
            .from('source_business_company_links')
            .update({ source_business_record_id: survivor, linker_version: MERGE_LINKER_VERSION })
            .eq('id', link.id as string);
        } else {
          await leadsClient.from('source_business_company_links').update({ is_current: false }).eq('id', link.id as string);
        }
        merge_log.push({ link_id: link.id, action: 'demoted_or_merged_link' });
      }
    }

    const { error: delLoserErr } = await leadsClient.from('source_business_records').delete().eq('id', loserId);
    if (delLoserErr) return { error: delLoserErr.message };
    merge_log.push({ deleted_source_business_record_id: loserId });
  }

  const { error: upErr } = await leadsClient
    .from('source_business_records')
    .update({
      name_raw,
      website,
      address_raw,
      updated_at: new Date().toISOString(),
    })
    .eq('id', survivor);
  if (upErr) return { error: upErr.message };

  merge_log.push({ survivor_source_business_record_id: survivor });
  return { ok: true, merge_log };
}

export interface SourceRecordDeleteImpact {
  source_business_record_id: string;
  current_link_count: number;
  sample_link_ids: string[];
}

export async function loadSourceRecordDeleteImpact(
  leadsClient: SupabaseClient,
  recordId: string,
): Promise<SourceRecordDeleteImpact> {
  const { data: links } = await leadsClient
    .from('source_business_company_links')
    .select('id')
    .eq('source_business_record_id', recordId)
    .eq('is_current', true);
  const sample_link_ids = (links ?? []).slice(0, 8).map((l) => l.id as string);
  return {
    source_business_record_id: recordId,
    current_link_count: links?.length ?? 0,
    sample_link_ids,
  };
}

export function isSourceRecordDeleteSafe(impact: SourceRecordDeleteImpact): boolean {
  return impact.current_link_count === 0;
}
