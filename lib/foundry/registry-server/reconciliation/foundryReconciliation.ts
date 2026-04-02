import type { SupabaseClient } from '@supabase/supabase-js';

export const MATCHER_VERSION = 'foundry_matcher_v1';
export const SCORING_VERSION = 'foundry_score_v1';
export const RULESET_VERSION = 'foundry_rules_v1';

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchScore(companyLegal: string, entityLegal: string): number {
  const a = normName(companyLegal);
  const b = normName(entityLegal);
  if (!a || !b) return 0;
  if (a === b) return 0.97;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return 0.35;
}

async function demotePromotedForCompanyState(
  leadsClient: SupabaseClient,
  companyId: string,
  registryState: string,
) {
  await leadsClient
    .from('company_entity_matches')
    .update({ is_current: false })
    .eq('company_id', companyId)
    .eq('registry_state', registryState)
    .eq('is_current', true)
    .eq('match_status', 'promoted');
}

export async function reconcileCompanyToStateEntity(
  leadsClient: SupabaseClient,
  params: {
    reconciliationRunId: string;
    companyId: string;
    stateEntityId: string;
  },
): Promise<{ outcome: 'matched' | 'no_match' | 'ambiguous' | 'error'; details?: Record<string, unknown> }> {
  const { data: co } = await leadsClient
    .from('companies')
    .select('legal_name')
    .eq('id', params.companyId)
    .single();
  const { data: ent } = await leadsClient
    .from('state_entities')
    .select('legal_name, state')
    .eq('id', params.stateEntityId)
    .single();
  if (!co || !ent) {
    return { outcome: 'error', details: { message: 'missing company or entity' } };
  }

  const score = matchScore(co.legal_name as string, (ent.legal_name as string) || '');
  const state = ent.state as string;

  if (score >= 0.9) {
    await demotePromotedForCompanyState(leadsClient, params.companyId, state);
    const { data: match, error } = await leadsClient
      .from('company_entity_matches')
      .insert({
        company_id: params.companyId,
        state_entity_id: params.stateEntityId,
        match_score: score,
        match_status: 'promoted',
        matcher_version: MATCHER_VERSION,
        scoring_version: SCORING_VERSION,
        ruleset_version: RULESET_VERSION,
        is_current: true,
      })
      .select('id')
      .single();
    if (error) {
      return { outcome: 'error', details: { message: error.message } };
    }
    await leadsClient.from('reconciliation_results').insert({
      reconciliation_run_id: params.reconciliationRunId,
      company_entity_match_id: match?.id as string,
      company_id: params.companyId,
      outcome: 'matched',
      details: { score, state_entity_id: params.stateEntityId },
      matcher_version: MATCHER_VERSION,
      scoring_version: SCORING_VERSION,
      ruleset_version: RULESET_VERSION,
    });
    return { outcome: 'matched', details: { score, match_id: match?.id } };
  }

  if (score >= 0.4) {
    const { data: match, error } = await leadsClient
      .from('company_entity_matches')
      .insert({
        company_id: params.companyId,
        state_entity_id: params.stateEntityId,
        match_score: score,
        match_status: 'candidate',
        matcher_version: MATCHER_VERSION,
        scoring_version: SCORING_VERSION,
        ruleset_version: RULESET_VERSION,
        is_current: true,
      })
      .select('id')
      .single();
    if (error) {
      return { outcome: 'error', details: { message: error.message } };
    }
    await leadsClient.from('review_tasks').insert({
      task_type: 'entity_match_review',
      entity_type: 'company_entity_match',
      entity_id: match?.id as string,
      status: 'pending',
      payload: { score, company_id: params.companyId, state_entity_id: params.stateEntityId },
    });
    await leadsClient.from('reconciliation_results').insert({
      reconciliation_run_id: params.reconciliationRunId,
      company_entity_match_id: match?.id as string,
      company_id: params.companyId,
      outcome: 'ambiguous',
      details: { score },
      matcher_version: MATCHER_VERSION,
      scoring_version: SCORING_VERSION,
      ruleset_version: RULESET_VERSION,
    });
    return { outcome: 'ambiguous', details: { score } };
  }

  await leadsClient.from('reconciliation_results').insert({
    reconciliation_run_id: params.reconciliationRunId,
    company_id: params.companyId,
    outcome: 'no_match',
    details: { score, state_entity_id: params.stateEntityId },
    matcher_version: MATCHER_VERSION,
    scoring_version: SCORING_VERSION,
    ruleset_version: RULESET_VERSION,
  });
  return { outcome: 'no_match', details: { score } };
}
