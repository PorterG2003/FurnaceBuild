import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mergeCompanies,
  mergeEntityOwners,
  type MergeCompaniesParams,
  type MergeEntityOwnersParams,
} from '@furnace/registry-server';

export {
  bucketCompaniesForMatching,
  deriveTargetStateForCompany,
  stateMatchingJobVersions,
  stateMatchingPreflight,
} from '@furnace/registry-server';
export {
  MATCHER_VERSION,
  reconcileCompanyToStateEntity,
  RULESET_VERSION,
  SCORING_VERSION,
} from '@furnace/registry-server';

export async function listReviewTasks(
  leadsClient: SupabaseClient,
  params: { status?: string; task_type?: string; limit: number },
) {
  let q = leadsClient
    .from('review_tasks')
    .select('id, task_type, entity_type, entity_id, status, priority, assigned_to, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(params.limit);
  if (params.status) q = q.eq('status', params.status);
  if (params.task_type) q = q.eq('task_type', params.task_type);
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
    company_dedupe_dismiss?: boolean;
    company_dedupe_merge?: MergeCompaniesParams;
    entity_owner_dedupe_dismiss?: boolean;
    entity_owner_dedupe_merge?: MergeEntityOwnersParams;
  },
  actorUserId: string,
) {
  const task = await getReviewTask(leadsClient, id);
  if (!task) return { error: 'not_found' as const };
  if (task.status === 'resolved') return { error: 'already_resolved' as const };

  if (task.task_type === 'company_dedupe') {
    if (body.company_dedupe_dismiss === true) {
      // resolve only
    } else {
      const m = body.company_dedupe_merge;
      if (!m?.survivor_company_id || !m.other_company_ids?.length) {
        return { error: 'company_dedupe_merge or company_dedupe_dismiss required' as const };
      }
      const r = await mergeCompanies(leadsClient, m);
      if ('error' in r) return { error: r.error };
    }
  }

  if (task.task_type === 'entity_owner_dedupe') {
    if (body.entity_owner_dedupe_dismiss === true) {
      // resolve only
    } else {
      const m = body.entity_owner_dedupe_merge;
      if (!m?.survivor_entity_owner_id || !m.other_entity_owner_ids?.length) {
        return { error: 'entity_owner_dedupe_merge or entity_owner_dedupe_dismiss required' as const };
      }
      const r = await mergeEntityOwners(leadsClient, m);
      if ('error' in r) return { error: r.error };
    }
  }

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
