import type { SupabaseClient } from '@supabase/supabase-js';
import type { IowaEntityDetailParsed } from '../iowa/types.js';
import { ensureEntityOwnerDedupeReviewTaskForCluster } from '../dedupe/entityOwnerDedupe.js';
import { ownerRowsForIowaDetail } from '../iowa/ownerRowsForIowaDetail.js';
import type { PersistEntityOwnerInput, PersistedEntityOwnerRow } from './ownerDrilldown.js';
import {
  replaceCurrentEntityOwners,
  upsertStateEntityCurrent,
} from './persistStateEntityCurrent.js';

export const IOWA_SOURCE_TYPE = 'iowa_sos_business_entities';
export const IOWA_PARSER_VERSION = 'iowa_registry_browser_v2';

const MAX_RESPONSE_PAYLOAD_CHARS = 120_000;

function truncatePayload(s: string): string {
  if (s.length <= MAX_RESPONSE_PAYLOAD_CHARS) return s;
  return `${s.slice(0, MAX_RESPONSE_PAYLOAD_CHARS)}\n…[truncated]`;
}

export type PersistIowaParams = {
  companyId: string;
  lookupKey: string;
  detail: IowaEntityDetailParsed;
  /** Combined or representative HTML stored on the snapshot (e.g. summary + officers). */
  detailHtml: string;
  searchQuery: string;
  hitStatus?: string;
  owners?: PersistEntityOwnerInput[];
  observedAt?: string;
};

/**
 * Insert immutable snapshot + state_entity + owner rows from an Iowa registry pull.
 */
export async function persistIowaRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistIowaParams,
): Promise<{ snapshot_id: string; state_entity_id: string; inserted: boolean; owners: PersistedEntityOwnerRow[] }> {
  const { data: snap, error: sErr } = await leadsClient
    .from('registry_source_snapshots')
    .insert({
      source_type: IOWA_SOURCE_TYPE,
      state: 'IA',
      lookup_key: params.lookupKey,
      request_payload: {
        company_id: params.companyId,
        search_query: params.searchQuery,
      },
      response_payload: {
        html_sample: truncatePayload(params.detailHtml),
        business_number: params.detail.businessNumber,
        entity_name: params.detail.legalName,
        officer_count: params.detail.officers.length,
      },
      parsed_successfully: true,
      parser_version: IOWA_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'iowa snapshot insert failed');

  const snapshotId = snap.id as string;
  const observedAt = params.observedAt ?? new Date().toISOString();
  const owners = params.owners ?? ownerRowsForIowaDetail(params.detail);

  const { state_entity_id, inserted } = await upsertStateEntityCurrent(leadsClient, {
    source_snapshot_id: snapshotId,
    state: 'IA',
    registry_entity_id: params.detail.businessNumber || null,
    legal_name: params.detail.legalName || null,
    entity_status: params.detail.status ?? params.hitStatus ?? null,
    raw_parsed: {
      officers: params.detail.officers,
      entity_type: params.detail.entityType,
      name_type: params.detail.nameType,
      chapter: params.detail.chapter,
      registered_agent_name: params.detail.registeredAgentName,
      principal_office_line: params.detail.principalOfficeLine,
      state_of_incorporation: params.detail.stateOfIncorporation,
      entity_status: params.detail.status,
    },
    parser_version: IOWA_PARSER_VERSION,
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
