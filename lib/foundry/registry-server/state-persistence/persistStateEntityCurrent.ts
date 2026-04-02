import type { SupabaseClient } from '@supabase/supabase-js';
import { formatOwnerDisplayName } from './formatOwnerDisplayName.js';
import { normalizeNameKey } from '../ingestion/normalizeSourceRecord.js';
import type { PersistEntityOwnerInput, PersistedEntityOwnerRow } from './ownerDrilldown.js';

type StateEntityRowInput = {
  source_snapshot_id: string;
  state: string;
  registry_entity_id: string | null;
  legal_name: string | null;
  entity_status: string | null;
  raw_parsed: Record<string, unknown>;
  parser_version: string;
};

const OWNER_SELECT =
  'id, owner_name, title_role, owner_normalized_key, owner_kind, resolution_status, resolved_state_entity_id, discovery_depth';

export async function upsertStateEntityCurrent(
  leadsClient: SupabaseClient,
  row: StateEntityRowInput,
): Promise<{ state_entity_id: string; inserted: boolean }> {
  const registryEntityId = row.registry_entity_id?.trim() || null;
  if (!registryEntityId) {
    const { data, error } = await leadsClient
      .from('state_entities')
      .insert(row)
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'state_entity insert failed');
    return { state_entity_id: data.id as string, inserted: true };
  }

  const { data: existing, error: existingErr } = await leadsClient
    .from('state_entities')
    .select('id')
    .eq('state', row.state)
    .eq('registry_entity_id', registryEntityId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);

  const currentId = Array.isArray(existing) && existing.length > 0 ? (existing[0]?.id as string | undefined) : undefined;
  if (!currentId) {
    const { data, error } = await leadsClient
      .from('state_entities')
      .insert({ ...row, registry_entity_id: registryEntityId })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'state_entity insert failed');
    return { state_entity_id: data.id as string, inserted: true };
  }

  const { data, error } = await leadsClient
    .from('state_entities')
    .update({
      source_snapshot_id: row.source_snapshot_id,
      legal_name: row.legal_name,
      entity_status: row.entity_status,
      raw_parsed: row.raw_parsed,
      parser_version: row.parser_version,
    })
    .eq('id', currentId)
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'state_entity update failed');
  return { state_entity_id: data.id as string, inserted: false };
}

export async function replaceCurrentEntityOwners(
  leadsClient: SupabaseClient,
  params: {
    stateEntityId: string;
    sourceSnapshotId: string;
    owners: PersistEntityOwnerInput[];
    observedAt: string;
  },
): Promise<PersistedEntityOwnerRow[]> {
  await leadsClient
    .from('entity_owners')
    .update({
      is_current: false,
      ended_at: params.observedAt,
    })
    .eq('state_entity_id', params.stateEntityId)
    .eq('is_current', true);

  if (params.owners.length === 0) {
    return [];
  }

  const payload = params.owners.map((owner) => {
    const formattedOwner = formatOwnerDisplayName(owner.ownerName);
    return {
      state_entity_id: params.stateEntityId,
      source_snapshot_id: params.sourceSnapshotId,
      owner_name: formattedOwner.displayName,
      title_role: owner.titleRole,
      is_current: true,
      observed_at: params.observedAt,
      owner_normalized_key: normalizeNameKey(formattedOwner.displayName),
      owner_kind: owner.ownerKind ?? null,
      resolution_status: owner.resolutionStatus ?? null,
      resolved_state_entity_id: owner.resolvedStateEntityId ?? null,
      discovery_depth: owner.discoveryDepth ?? null,
      resolution_notes: owner.resolutionNotes ?? {},
    };
  });

  const { data, error } = await leadsClient.from('entity_owners').insert(payload).select(OWNER_SELECT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as PersistedEntityOwnerRow[]).map((row) => ({
    id: row.id,
    owner_name: row.owner_name,
    title_role: row.title_role,
    owner_normalized_key: row.owner_normalized_key,
    owner_kind: row.owner_kind,
    resolution_status: row.resolution_status,
    resolved_state_entity_id: row.resolved_state_entity_id,
    discovery_depth: row.discovery_depth,
  }));
}

export async function updateEntityOwnerResolution(
  leadsClient: SupabaseClient,
  params: {
    entityOwnerId: string;
    resolutionStatus: string;
    resolvedStateEntityId?: string | null;
    resolutionNotes?: Record<string, unknown> | null;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    resolution_status: params.resolutionStatus,
  };
  if (params.resolvedStateEntityId !== undefined) {
    payload.resolved_state_entity_id = params.resolvedStateEntityId;
  }
  if (params.resolutionNotes !== undefined) {
    payload.resolution_notes = params.resolutionNotes ?? {};
  }
  const { error } = await leadsClient.from('entity_owners').update(payload).eq('id', params.entityOwnerId);
  if (error) throw new Error(error.message);
}
