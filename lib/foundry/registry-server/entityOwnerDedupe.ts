import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNameKey } from './normalizeSourceRecord.js';

export interface EntityOwnerDeleteImpact {
  entity_owner_id: string;
  history_count: number;
}

export function entityOwnerDeleteImpactFingerprint(impact: EntityOwnerDeleteImpact): string {
  return `history:${impact.history_count}`;
}

export function isEntityOwnerDeleteSafe(impact: EntityOwnerDeleteImpact): boolean {
  return impact.history_count === 0;
}

export async function loadEntityOwnerDeleteImpact(
  leadsClient: SupabaseClient,
  entityOwnerId: string,
): Promise<EntityOwnerDeleteImpact> {
  const { count, error } = await leadsClient
    .from('entity_owner_history')
    .select('id', { count: 'exact', head: true })
    .eq('entity_owner_id', entityOwnerId);
  if (error) throw new Error(error.message);
  return {
    entity_owner_id: entityOwnerId,
    history_count: count ?? 0,
  };
}

/**
 * When two or more current entity_owners share state_entity_id + owner_normalized_key,
 * ensure one pending entity_owner_dedupe task with an up-to-date candidate list.
 */
export async function ensureEntityOwnerDedupeReviewTaskForCluster(
  leadsClient: SupabaseClient,
  stateEntityId: string,
  ownerNormalizedKey: string | null | undefined,
): Promise<void> {
  if (!ownerNormalizedKey) return;

  const { data: rows, error: qErr } = await leadsClient
    .from('entity_owners')
    .select('id')
    .eq('state_entity_id', stateEntityId)
    .eq('owner_normalized_key', ownerNormalizedKey)
    .eq('is_current', true)
    .order('id', { ascending: true });
  if (qErr) throw new Error(qErr.message);
  const list = rows ?? [];
  if (list.length < 2) return;

  const candidateIds = list.map((r) => r.id as string);
  const entityId = candidateIds[0]!;

  const { data: existingRows, error: exErr } = await leadsClient
    .from('review_tasks')
    .select('id, payload')
    .eq('task_type', 'entity_owner_dedupe')
    .eq('status', 'pending')
    .eq('payload->>state_entity_id', stateEntityId)
    .eq('payload->>owner_normalized_key', ownerNormalizedKey);

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
          candidate_entity_owner_ids: candidateIds,
          state_entity_id: stateEntityId,
          owner_normalized_key: ownerNormalizedKey,
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
    task_type: 'entity_owner_dedupe',
    entity_type: 'entity_owner',
    entity_id: entityId,
    status: 'pending',
    priority: 0,
    payload: {
      candidate_entity_owner_ids: candidateIds,
      state_entity_id: stateEntityId,
      owner_normalized_key: ownerNormalizedKey,
    },
  });
  if (insErr) throw new Error(insErr.message);
}

export type MergeEntityOwnersParams = {
  survivor_entity_owner_id: string;
  other_entity_owner_ids: string[];
  merged?: {
    owner_name?: string;
    title_role?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
};

export async function mergeEntityOwners(
  leadsClient: SupabaseClient,
  params: MergeEntityOwnersParams,
): Promise<{ ok: true; merge_log: Record<string, unknown>[] } | { error: string }> {
  const survivor = params.survivor_entity_owner_id;
  const losers = [...new Set(params.other_entity_owner_ids)].filter((id) => id && id !== survivor);
  if (!survivor || losers.length === 0) {
    return { error: 'survivor_entity_owner_id and at least one other_entity_owner_id required' };
  }

  const mergeSet = new Set([survivor, ...losers]);
  const { data: rows, error: roErr } = await leadsClient
    .from('entity_owners')
    .select(
      'id, state_entity_id, owner_name, title_role, first_name, last_name, owner_normalized_key, is_current',
    )
    .in('id', [...mergeSet]);
  if (roErr) return { error: roErr.message };
  if (!rows || rows.length !== mergeSet.size) {
    return { error: 'one or more entity_owner ids not found' };
  }

  const notCurrent = rows.find((r) => r.is_current !== true);
  if (notCurrent) return { error: 'merge set must be current entity_owners only' };

  const stateEntityId = rows[0]!.state_entity_id as string;
  if (rows.some((r) => (r.state_entity_id as string) !== stateEntityId)) {
    return { error: 'all merged entity_owners must share the same state_entity_id' };
  }

  const survRow = rows.find((r) => r.id === survivor);
  if (!survRow) return { error: 'survivor not found' };

  const owner_name =
    params.merged?.owner_name != null
      ? String(params.merged.owner_name).trim()
      : (survRow.owner_name as string);
  if (!owner_name) return { error: 'owner_name empty' };
  const title_role =
    params.merged?.title_role !== undefined
      ? params.merged.title_role
      : ((survRow.title_role as string | null) ?? null);
  const first_name =
    params.merged?.first_name !== undefined
      ? params.merged.first_name
      : ((survRow.first_name as string | null) ?? null);
  const last_name =
    params.merged?.last_name !== undefined
      ? params.merged.last_name
      : ((survRow.last_name as string | null) ?? null);

  const owner_normalized_key = normalizeNameKey(owner_name);

  const { data: outsiders } = await leadsClient
    .from('entity_owners')
    .select('id')
    .eq('state_entity_id', stateEntityId)
    .eq('owner_normalized_key', owner_normalized_key)
    .eq('is_current', true);
  const bad = outsiders?.find((r) => !mergeSet.has(r.id as string));
  if (bad) {
    return { error: 'owner_normalized_key conflict with another entity_owner outside merge set' };
  }

  const merge_log: Record<string, unknown>[] = [];

  const { error: upErr } = await leadsClient
    .from('entity_owners')
    .update({
      owner_name,
      title_role,
      first_name,
      last_name,
      owner_normalized_key,
      updated_at: new Date().toISOString(),
    })
    .eq('id', survivor);
  if (upErr) return { error: upErr.message };

  for (const loserId of losers) {
    const { error: delErr } = await leadsClient.from('entity_owners').delete().eq('id', loserId);
    if (delErr) return { error: delErr.message };
    merge_log.push({ deleted_entity_owner_id: loserId });
  }

  merge_log.push({ survivor_entity_owner_id: survivor, owner_normalized_key });
  return { ok: true, merge_log };
}
