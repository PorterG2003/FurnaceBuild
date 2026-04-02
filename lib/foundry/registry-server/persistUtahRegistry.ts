import type { SupabaseClient } from '@supabase/supabase-js';
import type { UtahEntityDetailParsed } from './utah/types.js';
import { ensureEntityOwnerDedupeReviewTaskForCluster } from './entityOwnerDedupe.js';
import { filterMemberPrincipals } from './utah/parseEntityDetailHtml.js';
import type { PersistEntityOwnerInput, PersistedEntityOwnerRow } from './ownerDrilldown.js';
import {
  replaceCurrentEntityOwners,
  upsertStateEntityCurrent,
} from './persistStateEntityCurrent.js';

export const UTAH_SOURCE_TYPE = 'utah_division_corporations';
export const UTAH_PARSER_VERSION = 'utah_registry_browser_v1';

const MAX_RESPONSE_PAYLOAD_CHARS = 120_000;

function truncatePayload(s: string): string {
  if (s.length <= MAX_RESPONSE_PAYLOAD_CHARS) return s;
  return `${s.slice(0, MAX_RESPONSE_PAYLOAD_CHARS)}\n…[truncated]`;
}

export type PersistUtahParams = {
  companyId: string;
  lookupKey: string;
  detail: UtahEntityDetailParsed;
  detailHtml: string;
  searchQuery: string;
  hitStatus?: string;
  owners?: PersistEntityOwnerInput[];
  observedAt?: string;
};

export function ownerRowsForUtahDetail(detail: UtahEntityDetailParsed): PersistEntityOwnerInput[] {
  return filterMemberPrincipals(detail.principals).map((p) => ({
    ownerName: p.name.trim() || 'Unknown',
    titleRole: p.title.trim() || null,
  }));
}

/**
 * Insert immutable snapshot + state_entity + owner rows from a Utah detail parse.
 */
export async function persistUtahRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistUtahParams,
): Promise<{ snapshot_id: string; state_entity_id: string; inserted: boolean; owners: PersistedEntityOwnerRow[] }> {
  const { data: snap, error: sErr } = await leadsClient
    .from('registry_source_snapshots')
    .insert({
      source_type: UTAH_SOURCE_TYPE,
      state: 'UT',
      lookup_key: params.lookupKey,
      request_payload: {
        company_id: params.companyId,
        search_query: params.searchQuery,
      },
      response_payload: {
        html_sample: truncatePayload(params.detailHtml),
        entity_number: params.detail.entityNumber,
        entity_name: params.detail.entityName,
        principal_count: params.detail.principals.length,
      },
      parsed_successfully: true,
      parser_version: UTAH_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'utah snapshot insert failed');

  const snapshotId = snap.id as string;
  const observedAt = params.observedAt ?? new Date().toISOString();
  const owners = params.owners ?? ownerRowsForUtahDetail(params.detail);

  const { state_entity_id, inserted } = await upsertStateEntityCurrent(leadsClient, {
      source_snapshot_id: snapshotId,
      state: 'UT',
      registry_entity_id: params.detail.entityNumber || null,
      legal_name: params.detail.entityName || null,
      entity_status: params.detail.entityStatus ?? params.hitStatus ?? null,
      raw_parsed: {
        principals: params.detail.principals,
        entity_status: params.detail.entityStatus,
      },
      parser_version: UTAH_PARSER_VERSION,
    });

  const insertedOwners = await replaceCurrentEntityOwners(leadsClient, {
    stateEntityId: state_entity_id,
    sourceSnapshotId: snapshotId,
    owners,
    observedAt,
  });

  for (const owner of insertedOwners) {
    const ownerKey = owner.owner_normalized_key ?? 'unknown';
    try {
      await ensureEntityOwnerDedupeReviewTaskForCluster(leadsClient, state_entity_id, ownerKey);
    } catch (e) {
      console.error('ensureEntityOwnerDedupeReviewTaskForCluster failed', e);
    }
  }

  return {
    snapshot_id: snapshotId,
    state_entity_id,
    inserted,
    owners: insertedOwners,
  };
}
