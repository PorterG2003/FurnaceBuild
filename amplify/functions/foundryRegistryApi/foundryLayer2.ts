import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mergeCompanies,
  mergeEntityOwners,
  promoteContactEnrichmentPersonToMatch,
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
    contact_enrichment_action?: 'accept_candidate' | 'reject' | 'suppress';
    chosen_candidate_index?: number;
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

  if (task.task_type === 'contact_enrichment_review' && task.entity_type === 'contact_enrichment_attempt') {
    const attemptId = task.entity_id as string;
    const action = body.contact_enrichment_action;
    if (!action) {
      return { error: 'contact_enrichment_action required' as const };
    }

    const { data: attempt, error: attErr } = await leadsClient
      .from('contact_enrichment_attempts')
      .select('id, target_id, response_payload, classification')
      .eq('id', attemptId)
      .maybeSingle();
    if (attErr) return { error: 'attempt_lookup_failed' as const };
    if (!attempt) return { error: 'not_found' as const };

    const targetId = String(attempt.target_id ?? '');
    const { data: target, error: targetErr } = await leadsClient
      .from('contact_enrichment_targets')
      .select(
        'id, foundry_job_id, ingestion_run_id, source_name, company_id, entity_owner_id, owner_name, owner_title_role, first_name, last_name, company_legal_name, address_line_1, address_line_2, address_city, address_state, address_postal_code, address_country, lookup_fingerprint, latest_source_observed_at',
      )
      .eq('id', targetId)
      .maybeSingle();
    if (targetErr || !target) return { error: 'target_not_found' as const };

    const targetRow = {
      id: String(target.id),
      foundry_job_id: String(target.foundry_job_id ?? ''),
      ingestion_run_id: String(target.ingestion_run_id ?? ''),
      source_name: String(target.source_name ?? ''),
      company_id: String(target.company_id ?? ''),
      entity_owner_id: target.entity_owner_id ? String(target.entity_owner_id) : null,
      owner_name: String(target.owner_name ?? ''),
      owner_title_role: target.owner_title_role ? String(target.owner_title_role) : null,
      first_name: String(target.first_name ?? ''),
      last_name: String(target.last_name ?? ''),
      company_legal_name: target.company_legal_name ? String(target.company_legal_name) : null,
      address_line_1: String(target.address_line_1 ?? ''),
      address_line_2: target.address_line_2 ? String(target.address_line_2) : null,
      address_city: target.address_city ? String(target.address_city) : null,
      address_state: target.address_state ? String(target.address_state) : null,
      address_postal_code: target.address_postal_code ? String(target.address_postal_code) : null,
      address_country: target.address_country ? String(target.address_country) : null,
      lookup_fingerprint: String(target.lookup_fingerprint ?? ''),
      latest_source_observed_at: target.latest_source_observed_at ? String(target.latest_source_observed_at) : null,
    };

    if (action === 'suppress') {
      const { error: supErr } = await leadsClient.from('contact_enrichment_suppressions').insert({
        provider: 'skipsherpa',
        lookup_type: 'person',
        company_id: targetRow.company_id,
        entity_owner_id: targetRow.entity_owner_id,
        reason: 'operator_suppressed_from_queue',
        created_by: actorUserId,
      });
      if (supErr && supErr.code !== '23505') {
        return { error: 'suppression_failed' as const };
      }
      await leadsClient
        .from('contact_enrichment_targets')
        .update({ status: 'skipped_suppressed', skip_reason: 'operator_suppressed_from_queue' })
        .eq('id', targetRow.id);
    } else if (action === 'reject') {
      await leadsClient.from('contact_enrichment_targets').update({ status: 'no_match' }).eq('id', targetRow.id);
    } else if (action === 'accept_candidate') {
      const idx = body.chosen_candidate_index;
      if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0) {
        return { error: 'chosen_candidate_index required' as const };
      }
      const payload = attempt.response_payload as { persons?: unknown[] } | null;
      const persons = Array.isArray(payload?.persons) ? payload!.persons! : [];
      const person = persons[idx];
      if (!person || typeof person !== 'object') {
        return { error: 'invalid_candidate_index' as const };
      }
      const { data: existing } = await leadsClient
        .from('contact_enrichment_matches')
        .select('id')
        .eq('attempt_id', attemptId)
        .maybeSingle();
      if (existing) {
        return { error: 'match_already_exists' as const };
      }
      await promoteContactEnrichmentPersonToMatch(leadsClient, attemptId, targetRow, person as never);
      await leadsClient.from('contact_enrichment_targets').update({ status: 'accepted' }).eq('id', targetRow.id);
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
