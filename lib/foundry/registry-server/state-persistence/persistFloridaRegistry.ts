import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FloridaEntityDetailParsed } from '../florida/types.js';
import { ownerRowsForFloridaDetail } from '../florida/floridaOwnerRows.js';
import { ensureEntityOwnerDedupeReviewTaskForCluster } from '../dedupe/entityOwnerDedupe.js';
import {
  computeCostAmountMicros,
  insertDirectCostRecord,
  type CostStatus,
  type ResolvedRunCost,
} from '../costRateCards.js';
import type { PersistEntityOwnerInput, PersistedEntityOwnerRow } from './ownerDrilldown.js';
import {
  replaceCurrentEntityOwners,
  upsertStateEntityCurrent,
} from './persistStateEntityCurrent.js';

export const FLORIDA_SOURCE_TYPE = 'florida_sunbiz';
export const FLORIDA_PARSER_VERSION = 'florida_registry_browser_v2';

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
  owners?: PersistEntityOwnerInput[];
  observedAt?: string;
  elapsedMs?: number | null;
  resolvedCost?: ResolvedRunCost | null;
  foundryJobId?: string | null;
  reconciliationRunId?: string | null;
};

export { ownerRowsForFloridaDetail } from '../florida/floridaOwnerRows.js';

/**
 * Insert immutable snapshot + state_entity + owner rows from a Florida Sunbiz detail parse.
 */
export async function persistFloridaRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistFloridaParams,
): Promise<{ snapshot_id: string; state_entity_id: string; inserted: boolean; owners: PersistedEntityOwnerRow[] }> {
  const snapshotId = randomUUID();
  const elapsedMs =
    typeof params.elapsedMs === 'number' && Number.isFinite(params.elapsedMs) ? Math.max(0, Math.trunc(params.elapsedMs)) : null;
  const initialCostStatus: CostStatus =
    elapsedMs != null && params.resolvedCost != null ? 'costed' : 'failed_or_not_costed';
  const { data: snap, error: sErr } = await leadsClient
    .from('registry_source_snapshots')
    .insert({
      id: snapshotId,
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
      elapsed_ms: elapsedMs,
      cost_status: initialCostStatus,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'florida snapshot insert failed');

  if (elapsedMs != null && params.resolvedCost != null) {
    const costRecord = await insertDirectCostRecord(leadsClient, {
      costKind: 'acquisition',
      provider: 'furnace_runtime',
      product: 'florida_registry_pull_ms',
      usageQuantity: elapsedMs,
      usageUnit: 'ms',
      costAmountMicros: computeCostAmountMicros({
        usageQuantity: elapsedMs,
        unitPriceCents: params.resolvedCost.unitPriceCents,
        unitQuantity: params.resolvedCost.unitQuantity,
      }),
      costRateCardId: params.resolvedCost.rateCardId,
      costIsOverride: params.resolvedCost.isOverride,
      estimationKind: 'runtime_estimate',
      sourceEntityType: 'registry_source_snapshot',
      sourceEntityId: snapshotId,
      companyId: params.companyId,
      foundryJobId: params.foundryJobId ?? null,
      reconciliationRunId: params.reconciliationRunId ?? null,
      meta: {
        state: 'FL',
        search_query: params.searchQuery,
      },
      createdAt: new Date().toISOString(),
    });
    const { error: costUpdateErr } = await leadsClient
      .from('registry_source_snapshots')
      .update({ cost_record_id: costRecord.id, cost_status: 'costed' })
      .eq('id', snapshotId);
    if (costUpdateErr) throw new Error(costUpdateErr.message);
  }

  const observedAt = params.observedAt ?? new Date().toISOString();
  const owners = params.owners ?? ownerRowsForFloridaDetail(params.detail);

  const { state_entity_id, inserted } = await upsertStateEntityCurrent(leadsClient, {
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
