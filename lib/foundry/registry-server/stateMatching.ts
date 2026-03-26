import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATCHER_VERSION,
  RULESET_VERSION,
  SCORING_VERSION,
} from './foundryReconciliation.js';

/** Target state: primary location, then any location, then null. */
export async function deriveTargetStateForCompany(
  leadsClient: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data: locs } = await leadsClient
    .from('company_locations')
    .select('state_region, is_primary, created_at')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false });

  const list = locs ?? [];
  const primary = list.find((l) => l.is_primary && l.state_region);
  if (primary?.state_region) return String(primary.state_region).slice(0, 2).toUpperCase();
  const any = list.find((l) => l.state_region);
  return any?.state_region ? String(any.state_region).slice(0, 2).toUpperCase() : null;
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

  for (const companyId of input.companyIds) {
    const state = await deriveTargetStateForCompany(leadsClient, companyId);
    if (!state) {
      missing_state.push(companyId);
      continue;
    }

    const { data: promoted } = await leadsClient
      .from('company_entity_matches')
      .select('id')
      .eq('company_id', companyId)
      .eq('registry_state', state)
      .eq('is_current', true)
      .eq('match_status', 'promoted')
      .maybeSingle();
    if (promoted) {
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
  for (const id of readyCompanyIds) {
    const st = await deriveTargetStateForCompany(leadsClient, id);
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
