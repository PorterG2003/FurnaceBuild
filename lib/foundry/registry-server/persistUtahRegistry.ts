import type { SupabaseClient } from '@supabase/supabase-js';
import type { UtahEntityDetailParsed } from './utah/types.js';
import { filterMemberPrincipals } from './utah/parseEntityDetailHtml.js';

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
};

/**
 * Insert immutable snapshot + state_entity + owner rows from a Utah detail parse.
 */
export async function persistUtahRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistUtahParams,
): Promise<{ snapshot_id: string; state_entity_id: string }> {
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
  const owners = filterMemberPrincipals(params.detail.principals);

  const { data: ent, error: eErr } = await leadsClient
    .from('state_entities')
    .insert({
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
    })
    .select('id')
    .single();
  if (eErr || !ent) throw new Error(eErr?.message ?? 'utah state_entity insert failed');

  const entityId = ent.id as string;
  for (const p of owners) {
    await leadsClient.from('entity_owners').insert({
      state_entity_id: entityId,
      source_snapshot_id: snapshotId,
      owner_name: p.name.trim() || 'Unknown',
      title_role: p.title.trim() || null,
      is_current: true,
    });
  }

  return { snapshot_id: snapshotId, state_entity_id: entityId };
}
