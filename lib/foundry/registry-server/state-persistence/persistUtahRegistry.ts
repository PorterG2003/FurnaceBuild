import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UtahEntityDetailParsed } from '../utah/types.js';
import { ensureEntityOwnerDedupeReviewTaskForCluster } from '../dedupe/entityOwnerDedupe.js';
import { eligibleIndividualRegisteredAgentName } from '../scrapers/registeredAgentPerson.js';
import { filterMemberPrincipals, utahPrincipalTitleIsMemberLike } from '../utah/parseEntityDetailHtml.js';
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

export const UTAH_SOURCE_TYPE = 'utah_division_corporations';
export const UTAH_PARSER_VERSION = 'utah_registry_browser_v2';

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
  elapsedMs?: number | null;
  resolvedCost?: ResolvedRunCost | null;
  foundryJobId?: string | null;
  reconciliationRunId?: string | null;
};

/**
 * Utah `entity_owners` from the principals grid.
 *
 * **Registered agent:** Utah has no separate RA field; RA may appear as a principal row. When the
 * entity has any member/manager/authorized-person row, **registered-agent principals are omitted**
 * (RA is not a fallback alongside real principals). If only RA-style rows remain, keep a row only
 * when {@link eligibleIndividualRegisteredAgentName} passes on the name.
 *
 * **Titles:** use the site title when present; normalize “registered agent” to **`Registered Agent`**;
 * use **`Officer`** when the title cell is blank.
 */
export function ownerRowsForUtahDetail(detail: UtahEntityDetailParsed): PersistEntityOwnerInput[] {
  let principals = filterMemberPrincipals(detail.principals);
  const hasMemberLike = principals.some(utahPrincipalTitleIsMemberLike);
  if (hasMemberLike) {
    principals = principals.filter((p) => !/registered\s*agent/i.test(p.title.trim()));
  }

  const rows = principals.map((p) => {
    const rawTitle = (p.title ?? '').trim();
    const titleRole = rawTitle
      ? /registered\s*agent/i.test(rawTitle)
        ? 'Registered Agent'
        : rawTitle
      : 'Officer';
    return { ownerName: p.name.trim() || 'Unknown', titleRole };
  });

  return rows.filter((r) => {
    if (r.titleRole !== 'Registered Agent') return true;
    return eligibleIndividualRegisteredAgentName(r.ownerName);
  });
}

/**
 * Insert immutable snapshot + state_entity + owner rows from a Utah detail parse.
 */
export async function persistUtahRegistryPull(
  leadsClient: SupabaseClient,
  params: PersistUtahParams,
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
      elapsed_ms: elapsedMs,
      cost_status: initialCostStatus,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'utah snapshot insert failed');

  if (elapsedMs != null && params.resolvedCost != null) {
    const costRecord = await insertDirectCostRecord(leadsClient, {
      costKind: 'acquisition',
      provider: 'furnace_runtime',
      product: 'utah_registry_pull_ms',
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
        state: 'UT',
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
