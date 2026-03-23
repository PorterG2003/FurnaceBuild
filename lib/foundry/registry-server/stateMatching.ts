import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATCHER_VERSION,
  RULESET_VERSION,
  SCORING_VERSION,
} from './foundryReconciliation.js';

export const MOCK_PARSER_VERSION = 'mock_registry_parser_v1';
export const MOCK_SOURCE_TYPE = 'mock_registry';

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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
 * Split preflight-ready companies by registry runner.
 * Utah uses ECS browser automation; other states use the mock connector until more connectors exist.
 */
export async function bucketCompaniesForMatching(
  leadsClient: SupabaseClient,
  readyCompanyIds: string[],
): Promise<{ mockCompanyIds: string[]; utahCompanyIds: string[] }> {
  const mockCompanyIds: string[] = [];
  const utahCompanyIds: string[] = [];
  for (const id of readyCompanyIds) {
    const st = await deriveTargetStateForCompany(leadsClient, id);
    if (st === 'UT') utahCompanyIds.push(id);
    else if (st) mockCompanyIds.push(id);
  }
  return { mockCompanyIds, utahCompanyIds };
}

/** Mock registry connector: snapshot + state_entity + placeholder owner. */
export async function runMockStateRunner(
  leadsClient: SupabaseClient,
  params: { companyId: string; targetState: string },
): Promise<{ snapshot_id: string; state_entity_id: string }> {
  const { data: co } = await leadsClient
    .from('companies')
    .select('id, legal_name, normalized_key')
    .eq('id', params.companyId)
    .single();
  if (!co) throw new Error('company not found');

  const lookupKey = (co.normalized_key as string | null) || normName(co.legal_name as string);
  const { data: snap, error: sErr } = await leadsClient
    .from('registry_source_snapshots')
    .insert({
      source_type: MOCK_SOURCE_TYPE,
      state: params.targetState,
      lookup_key: lookupKey,
      request_payload: { mock: true, company_id: params.companyId },
      response_payload: { mock: true, entities: 1 },
      parsed_successfully: true,
      parser_version: MOCK_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (sErr || !snap) throw new Error(sErr?.message ?? 'snapshot insert failed');

  const regId = `MOCK-${(snap.id as string).slice(0, 8)}`;
  const { data: ent, error: eErr } = await leadsClient
    .from('state_entities')
    .insert({
      source_snapshot_id: snap.id as string,
      state: params.targetState,
      registry_entity_id: regId,
      legal_name: co.legal_name as string,
      entity_status: 'active',
      raw_parsed: { mock: true },
      parser_version: MOCK_PARSER_VERSION,
    })
    .select('id')
    .single();
  if (eErr || !ent) throw new Error(eErr?.message ?? 'entity insert failed');

  await leadsClient.from('entity_owners').insert({
    state_entity_id: ent.id as string,
    source_snapshot_id: snap.id as string,
    owner_name: 'Mock Officer',
    title_role: 'Mock',
    is_current: true,
  });

  return { snapshot_id: snap.id as string, state_entity_id: ent.id as string };
}

export function stateMatchingJobVersions() {
  return {
    matcher_version: MATCHER_VERSION,
    scoring_version: SCORING_VERSION,
    ruleset_version: RULESET_VERSION,
  };
}
