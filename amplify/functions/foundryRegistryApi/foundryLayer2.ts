import type { SupabaseClient } from '@supabase/supabase-js';

export const MOCK_PARSER_VERSION = 'mock_registry_parser_v1';
export const MOCK_SOURCE_TYPE = 'mock_registry';
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

/** Mock state runner: persists snapshot + one state_entity (+ optional owner). */
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

export async function executeStateMatchingBatch(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<{ run_id: string; per_company: Record<string, unknown>[] }> {
  const pre = await stateMatchingPreflight(leadsClient, { companyIds });
  const { data: run, error: rErr } = await leadsClient
    .from('reconciliation_runs')
    .insert({
      status: 'running',
      matcher_version: MATCHER_VERSION,
      scoring_version: SCORING_VERSION,
      ruleset_version: RULESET_VERSION,
      meta: {
        run_kind: 'state_matching_orchestration',
        preflight: pre,
        mock_runner: true,
      },
    })
    .select('id')
    .single();
  if (rErr || !run) throw new Error(rErr?.message ?? 'run create failed');
  const runId = run.id as string;

  const per_company: Record<string, unknown>[] = [];
  for (const companyId of pre.ready) {
    const state = await deriveTargetStateForCompany(leadsClient, companyId);
    if (!state) continue;
    try {
      const { state_entity_id } = await runMockStateRunner(leadsClient, { companyId, targetState: state });
      const recon = await reconcileCompanyToStateEntity(leadsClient, {
        reconciliationRunId: runId,
        companyId,
        stateEntityId: state_entity_id,
      });
      per_company.push({ companyId, state, state_entity_id, ...recon });
    } catch (e) {
      per_company.push({
        companyId,
        error: e instanceof Error ? e.message : String(e),
      });
      await leadsClient.from('reconciliation_results').insert({
        reconciliation_run_id: runId,
        company_id: companyId,
        outcome: 'error',
        details: { message: e instanceof Error ? e.message : String(e) },
        matcher_version: MATCHER_VERSION,
        scoring_version: SCORING_VERSION,
        ruleset_version: RULESET_VERSION,
      });
    }
  }

  await leadsClient
    .from('reconciliation_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      meta: {
        run_kind: 'state_matching_orchestration',
        preflight: pre,
        per_company,
        mock_runner: true,
      },
    })
    .eq('id', runId);

  return { run_id: runId, per_company };
}

export async function listReviewTasks(leadsClient: SupabaseClient, params: { status?: string; limit: number }) {
  let q = leadsClient
    .from('review_tasks')
    .select('id, task_type, entity_type, entity_id, status, priority, assigned_to, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(params.limit);
  if (params.status) q = q.eq('status', params.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getReviewTask(leadsClient: SupabaseClient, id: string) {
  const { data, error } = await leadsClient.from('review_tasks').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function resolveReviewTask(
  leadsClient: SupabaseClient,
  id: string,
  body: {
    resolution: Record<string, unknown>;
    chosen_company_id?: string;
    chosen_match_action?: 'promote' | 'reject';
  },
  actorUserId: string,
) {
  const task = await getReviewTask(leadsClient, id);
  if (!task) return { error: 'not_found' as const };
  if (task.status === 'resolved') return { error: 'already_resolved' as const };

  if (task.task_type === 'source_link_review' && task.entity_type === 'source_business_record') {
    const recordId = task.entity_id as string;
    const companyId = body.chosen_company_id;
    if (!companyId) return { error: 'chosen_company_id required' };
    await leadsClient
      .from('source_business_company_links')
      .update({ is_current: false })
      .eq('source_business_record_id', recordId)
      .eq('is_current', true);
    await leadsClient.from('source_business_company_links').insert({
      source_business_record_id: recordId,
      company_id: companyId,
      link_status: 'linked',
      link_score: 1,
      linker_version: 'foundry_manual_review_v1',
      is_current: true,
    });
  }

  if (task.task_type === 'entity_match_review' && task.entity_type === 'company_entity_match') {
    const matchId = task.entity_id as string;
    const { data: mrow } = await leadsClient
      .from('company_entity_matches')
      .select('id, company_id, registry_state')
      .eq('id', matchId)
      .single();
    if (body.chosen_match_action === 'promote' && mrow) {
      await leadsClient
        .from('company_entity_matches')
        .update({ is_current: false })
        .eq('company_id', mrow.company_id as string)
        .eq('registry_state', mrow.registry_state as string)
        .eq('is_current', true)
        .eq('match_status', 'promoted');
      await leadsClient
        .from('company_entity_matches')
        .update({ match_status: 'promoted', is_current: true })
        .eq('id', matchId);
    }
    if (body.chosen_match_action === 'reject') {
      await leadsClient
        .from('company_entity_matches')
        .update({ match_status: 'rejected', is_current: false })
        .eq('id', matchId);
    }
  }

  await leadsClient
    .from('review_tasks')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution: { ...body.resolution, resolved_by: actorUserId },
    })
    .eq('id', id);

  return { ok: true as const };
}
