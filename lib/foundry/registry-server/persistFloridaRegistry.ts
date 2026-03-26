import type { SupabaseClient } from '@supabase/supabase-js';
import type { FloridaEntityDetailParsed } from './florida/types.js';
import { ensureEntityOwnerDedupeReviewTaskForCluster } from './entityOwnerDedupe.js';
import { normalizeNameKey } from './normalizeSourceRecord.js';
import { filterFloridaOwnerPeople } from './florida/parseEntityDetailHtml.js';

export const FLORIDA_SOURCE_TYPE = 'florida_sunbiz';
export const FLORIDA_PARSER_VERSION = 'florida_registry_browser_v1';

const MAX_RESPONSE_PAYLOAD_CHARS = 120_000;

function truncatePayload(s: string): string {
  if (s.length <= MAX_RESPONSE_PAYLOAD_CHARS) return s;
  return `${s.slice(0, MAX_RESPONSE_PAYLOAD_CHARS)}\n…[truncated]`;
}

export type PersistFloridaParams = {
  companyId: string;
  lookupKey: string;
  detail: FloridaEntityDetailParsed;
  detailHtml: string;
  searchQuery: string;
  hitStatus?: string;
};

function ownerRowsForDetail(detail: FloridaEntityDetailParsed): { name: string; title: string | null }[] {
  const structured = detail.people.filter((p) => p.source !== 'registered_agent');
  const rows = structured.map((p) => ({
    name: p.name.trim() || 'Unknown',
    title: p.title.trim() || null,
  }));
  if (rows.length > 0) return rows;
  return filterFloridaOwnerPeople(detail).map((name) => ({ name: name.trim() || 'Unknown', title: null }));
}

/**
 * Insert immutable snapshot + state_entity + owner rows from a Florida Sunbiz detail parse.
 */
export async function persistFloridaRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistFloridaParams,
): Promise<{ snapshot_id: string; state_entity_id: string }> {
  const { data: snap, error: sErr } = await leadsClient
    .from('registry_source_snapshots')
    .insert({
      source_type: FLORIDA_SOURCE_TYPE,
      state: 'FL',
      lookup_key: params.lookupKey,
      request_payload: {
        company_id: params.companyId,
        search_query: params.searchQuery,
      },
      response_payload: {
        html_sample: truncatePayload(params.detailHtml),
        document_number: params.detail.documentNumber,
        entity_name: params.detail.entityName,
        people_count: params.detail.people.length,
      },
      parsed_successfully: true,
      parser_version: FLORIDA_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'florida snapshot insert failed');

  const snapshotId = snap.id as string;
  const owners = ownerRowsForDetail(params.detail);

  const { data: ent, error: eErr } = await leadsClient
    .from('state_entities')
    .insert({
      source_snapshot_id: snapshotId,
      state: 'FL',
      registry_entity_id: params.detail.documentNumber || null,
      legal_name: params.detail.entityName || null,
      entity_status: params.detail.status ?? params.hitStatus ?? null,
      raw_parsed: {
        people: params.detail.people,
        entity_type_label: params.detail.entityTypeLabel,
        registered_agent_name: params.detail.registeredAgentName,
        entity_status: params.detail.status,
      },
      parser_version: FLORIDA_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (eErr || !ent) throw new Error(eErr?.message ?? 'florida state_entity insert failed');

  const entityId = ent.id as string;
  for (const p of owners) {
    const ownerName = p.name.trim() || 'Unknown';
    const ownerKey = normalizeNameKey(ownerName);
    await leadsClient.from('entity_owners').insert({
      state_entity_id: entityId,
      source_snapshot_id: snapshotId,
      owner_name: ownerName,
      title_role: p.title,
      is_current: true,
      owner_normalized_key: ownerKey,
    });
    try {
      await ensureEntityOwnerDedupeReviewTaskForCluster(leadsClient, entityId, ownerKey);
    } catch (e) {
      console.error('ensureEntityOwnerDedupeReviewTaskForCluster failed', e);
    }
  }

  return { snapshot_id: snapshotId, state_entity_id: entityId };
}
