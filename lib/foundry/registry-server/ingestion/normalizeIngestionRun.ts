import type { SupabaseClient } from '@supabase/supabase-js';
import { buildResolutionMeta, NORMALIZER_VERSION } from './normalizeSourceRecord.js';

/**
 * Normalize up to `limit` rows for a run (legacy synchronous API — no cursor).
 */
export async function normalizeIngestionRunRecords(
  leadsClient: SupabaseClient,
  runId: string,
  limit: number,
): Promise<{ updated: number; scanned: number }> {
  const { data: rows, error } = await leadsClient
    .from('source_business_records')
    .select('id, name_raw, website, address_raw, resolution_meta')
    .eq('ingestion_run_id', runId)
    .limit(limit);

  if (error) throw new Error(error.message);
  const list = rows ?? [];
  let updated = 0;
  for (const r of list) {
    const meta = buildResolutionMeta({
      name_raw: r.name_raw as string,
      website: r.website as string | null,
      address_raw: r.address_raw as string | null,
    });
    const prev = (r.resolution_meta ?? {}) as Record<string, unknown>;
    if (prev.normalizer_version === NORMALIZER_VERSION && prev.normalized_name_key === meta.normalized_name_key) {
      continue;
    }
    const { error: uerr } = await leadsClient
      .from('source_business_records')
      .update({ resolution_meta: meta as unknown as Record<string, unknown> })
      .eq('id', r.id as string);
    if (!uerr) updated += 1;
  }
  return { updated, scanned: list.length };
}

export interface NormalizeChunkResult {
  updated: number;
  scanned: number;
  /** Pass to next chunk; null when no more pages. */
  nextCursor: string | null;
  /** True when there are no rows in this page (nothing left). */
  done: boolean;
}

/**
 * Stable keyset page of normalization updates for Step Functions loops.
 */
export async function normalizeIngestionRunRecordsChunk(
  leadsClient: SupabaseClient,
  runId: string,
  batchSize: number,
  cursor: string | null,
): Promise<NormalizeChunkResult> {
  let q = leadsClient
    .from('source_business_records')
    .select('id, name_raw, website, address_raw, resolution_meta')
    .eq('ingestion_run_id', runId)
    .order('id', { ascending: true })
    .limit(batchSize);

  if (cursor) {
    q = q.gt('id', cursor);
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const list = rows ?? [];

  if (list.length === 0) {
    return { updated: 0, scanned: 0, nextCursor: null, done: true };
  }

  let updated = 0;
  for (const r of list) {
    const meta = buildResolutionMeta({
      name_raw: r.name_raw as string,
      website: r.website as string | null,
      address_raw: r.address_raw as string | null,
    });
    const prev = (r.resolution_meta ?? {}) as Record<string, unknown>;
    if (prev.normalizer_version === NORMALIZER_VERSION && prev.normalized_name_key === meta.normalized_name_key) {
      continue;
    }
    const { error: uerr } = await leadsClient
      .from('source_business_records')
      .update({ resolution_meta: meta as unknown as Record<string, unknown> })
      .eq('id', r.id as string);
    if (!uerr) updated += 1;
  }

  const lastId = list[list.length - 1]!.id as string;
  const hasMore = list.length === batchSize;
  return {
    updated,
    scanned: list.length,
    nextCursor: hasMore ? lastId : null,
    done: !hasMore,
  };
}
