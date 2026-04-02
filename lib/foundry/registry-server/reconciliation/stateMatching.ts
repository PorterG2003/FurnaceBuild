import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATCHER_VERSION,
  RULESET_VERSION,
  SCORING_VERSION,
} from './foundryReconciliation.js';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeState(value: unknown): string | null {
  const state = typeof value === 'string' ? value.trim() : '';
  return state ? state.slice(0, 2).toUpperCase() : null;
}

async function loadTargetStatesForCompanies(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, string | null>> {
  const targetStates = new Map<string, string | null>();
  for (const companyId of companyIds) {
    targetStates.set(companyId, null);
  }

  for (const ids of chunk([...new Set(companyIds)], 200)) {
    const { data: locs, error } = await leadsClient
      .from('company_locations')
      .select('company_id, state_region, is_primary, created_at')
      .in('company_id', ids)
      .order('company_id', { ascending: true })
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const fallbackStates = new Map<string, string>();
    for (const loc of locs ?? []) {
      const companyId = typeof loc.company_id === 'string' ? loc.company_id : '';
      if (!companyId) continue;
      const state = normalizeState(loc.state_region);
      if (!state) continue;
      if (loc.is_primary) {
        targetStates.set(companyId, state);
      } else if (!targetStates.get(companyId) && !fallbackStates.has(companyId)) {
        fallbackStates.set(companyId, state);
      }
    }

    for (const [companyId, state] of fallbackStates.entries()) {
      if (!targetStates.get(companyId)) {
        targetStates.set(companyId, state);
      }
    }
  }

  return targetStates;
}

async function loadPromotedMatchKeys(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<Set<string>> {
  const promotedKeys = new Set<string>();
  for (const ids of chunk([...new Set(companyIds)], 200)) {
    const { data, error } = await leadsClient
      .from('company_entity_matches')
      .select('company_id, registry_state')
      .eq('is_current', true)
      .eq('match_status', 'promoted')
      .in('company_id', ids);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : '';
      const state = normalizeState(row.registry_state);
      if (companyId && state) {
        promotedKeys.add(`${companyId}:${state}`);
      }
    }
  }
  return promotedKeys;
}

/** Target state: primary location, then any location, then null. */
export async function deriveTargetStateForCompany(
  leadsClient: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const targetStates = await loadTargetStatesForCompanies(leadsClient, [companyId]);
  return targetStates.get(companyId) ?? null;
}

export async function stateMatchingPreflight(
  leadsClient: SupabaseClient,
  input: { companyIds: string[] },
): Promise<{
  ready: string[];
  missing_state: string[];
  already_matched: string[];
  not_linked: string[];
}> {
  const ready: string[] = [];
  const missing_state: string[] = [];
  const already_matched: string[] = [];
  const not_linked: string[] = [];
  const targetStates = await loadTargetStatesForCompanies(leadsClient, input.companyIds);
  const promotedKeys = await loadPromotedMatchKeys(leadsClient, input.companyIds);

  for (const companyId of input.companyIds) {
    const state = targetStates.get(companyId) ?? null;
    if (!state) {
      missing_state.push(companyId);
      continue;
    }

    if (promotedKeys.has(`${companyId}:${state}`)) {
      already_matched.push(companyId);
      continue;
    }

    ready.push(companyId);
  }

  return { ready, missing_state, already_matched, not_linked };
}

/**
 * Split preflight-ready companies by supported registry automation (UT / FL ECS only).
 */
export async function bucketCompaniesForMatching(
  leadsClient: SupabaseClient,
  readyCompanyIds: string[],
): Promise<{
  utahCompanyIds: string[];
  floridaCompanyIds: string[];
  unsupported: { company_id: string; state: string }[];
}> {
  const utahCompanyIds: string[] = [];
  const floridaCompanyIds: string[] = [];
  const unsupported: { company_id: string; state: string }[] = [];
  const targetStates = await loadTargetStatesForCompanies(leadsClient, readyCompanyIds);
  for (const id of readyCompanyIds) {
    const st = targetStates.get(id) ?? null;
    if (st === 'UT') utahCompanyIds.push(id);
    else if (st === 'FL') floridaCompanyIds.push(id);
    else if (st) unsupported.push({ company_id: id, state: st });
  }
  return { utahCompanyIds, floridaCompanyIds, unsupported };
}

export function stateMatchingJobVersions() {
  return {
    matcher_version: MATCHER_VERSION,
    scoring_version: SCORING_VERSION,
    ruleset_version: RULESET_VERSION,
  };
}
