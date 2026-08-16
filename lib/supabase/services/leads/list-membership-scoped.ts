import { supabase } from '../../client';
import type { BulkScope } from '@/lib/leads/workbench/bulk/bulkScope';
import {
  explorerQueryToRpcParams,
  listMembershipReviewRpcForScope,
  savedListQueryToRpcParams,
} from '@/lib/leads/workbench/bulk/bulkScopeToRpcParams';
import type {
  AddListMembershipReviewSummary,
  RemoveListMembershipReviewSummary,
} from './list-membership-review';
import type {
  AddMembersToSavedLeadListResult,
  RemoveMembersFromSavedLeadListResult,
} from './saved-lists';

type RpcAddReviewSummary = {
  requested?: number;
  alreadyMember?: number;
  toAdd?: number;
  notInAccount?: number;
};

type RpcRemoveReviewSummary = {
  requested?: number;
  inList?: number;
  toRemove?: number;
  notInList?: number;
};

type RpcAddApplyResult = {
  added?: number;
  skippedAlreadyMember?: number;
  skippedInvalid?: number;
};

type RpcRemoveApplyResult = {
  removed?: number;
  skippedNotMember?: number;
};

function parseAddReviewSummary(data: unknown): AddListMembershipReviewSummary {
  const summary = (data ?? {}) as RpcAddReviewSummary;
  return {
    requested: summary.requested ?? 0,
    alreadyMember: summary.alreadyMember ?? 0,
    toAdd: summary.toAdd ?? 0,
    notInAccount: summary.notInAccount ?? 0,
  };
}

function parseRemoveReviewSummary(data: unknown): RemoveListMembershipReviewSummary {
  const summary = (data ?? {}) as RpcRemoveReviewSummary;
  return {
    requested: summary.requested ?? 0,
    inList: summary.inList ?? 0,
    toRemove: summary.toRemove ?? 0,
    notInList: summary.notInList ?? 0,
  };
}

function parseAddApplyResult(data: unknown): AddMembersToSavedLeadListResult {
  const result = (data ?? {}) as RpcAddApplyResult;
  return {
    added: result.added ?? 0,
    skippedAlreadyMember: result.skippedAlreadyMember ?? 0,
    skippedInvalid: result.skippedInvalid ?? 0,
  };
}

function parseRemoveApplyResult(data: unknown): RemoveMembersFromSavedLeadListResult {
  const result = (data ?? {}) as RpcRemoveApplyResult;
  return {
    removed: result.removed ?? 0,
    skippedNotMember: result.skippedNotMember ?? 0,
  };
}

export async function getListMembershipReviewForScope(
  accountId: string,
  listId: string,
  scope: BulkScope,
  mode: 'add' | 'remove',
): Promise<AddListMembershipReviewSummary | RemoveListMembershipReviewSummary> {
  const mapped = listMembershipReviewRpcForScope(scope, mode);
  const baseParams = { p_account_id: accountId, p_list_id: listId };

  if (mapped.rpc === 'saved_list_membership_review_summary') {
    const { data, error } = await supabase.rpc(mapped.rpc, {
      ...baseParams,
      p_global_lead_ids: mapped.params.p_global_lead_ids,
      p_mode: mapped.params.p_mode,
    });
    if (error) throw new Error(error.message);
    return mode === 'add'
      ? parseAddReviewSummary(data)
      : parseRemoveReviewSummary(data);
  }

  if (mapped.rpc === 'saved_list_membership_review_summary_for_list') {
    const { data, error } = await supabase.rpc(mapped.rpc, {
      ...baseParams,
      p_mode: mapped.params.p_mode,
    });
    if (error) throw new Error(error.message);
    return mode === 'add'
      ? parseAddReviewSummary(data)
      : parseRemoveReviewSummary(data);
  }

  if (mapped.rpc === 'saved_list_membership_review_summary_for_list_view') {
    const { data, error } = await supabase.rpc(mapped.rpc, {
      ...baseParams,
      p_mode: mapped.params.p_mode,
      p_campaign_ids: mapped.params.p_campaign_ids,
      p_reply_statuses: mapped.params.p_reply_statuses,
      p_enrollment_states: mapped.params.p_enrollment_states,
      p_reply_categories: mapped.params.p_reply_categories,
      p_search: mapped.params.p_search,
      p_tag_ids: mapped.params.p_tag_ids,
    });
    if (error) throw new Error(error.message);
    return mode === 'add'
      ? parseAddReviewSummary(data)
      : parseRemoveReviewSummary(data);
  }

  const { data, error } = await supabase.rpc(mapped.rpc, {
    ...baseParams,
    p_mode: mapped.params.p_mode,
    p_global_lead_ids: mapped.params.p_global_lead_ids,
    p_campaign_ids: mapped.params.p_campaign_ids,
    p_reply_statuses: mapped.params.p_reply_statuses,
    p_enrollment_states: mapped.params.p_enrollment_states,
    p_reply_categories: mapped.params.p_reply_categories,
    p_search: mapped.params.p_search,
    p_tag_ids: mapped.params.p_tag_ids,
  });
  if (error) throw new Error(error.message);
  return mode === 'add'
    ? parseAddReviewSummary(data)
    : parseRemoveReviewSummary(data);
}

export async function applyListMembershipForScope(
  accountId: string,
  listId: string,
  scope: BulkScope,
  mode: 'add' | 'remove',
  options?: { source?: 'selection' | 'manual' },
): Promise<AddMembersToSavedLeadListResult | RemoveMembersFromSavedLeadListResult | { removed: number }> {
  if (mode === 'add') {
    if (scope.kind !== 'explorerView') {
      throw new Error('Add apply for scope requires explorer view.');
    }
    const params = explorerQueryToRpcParams(scope.query);
    const { data, error } = await supabase.rpc('add_members_to_saved_lead_list_for_explorer_view', {
      p_account_id: accountId,
      p_list_id: listId,
      p_source: options?.source ?? 'selection',
      ...params,
    });
    if (error) throw new Error(error.message);
    return parseAddApplyResult(data);
  }

  if (scope.kind === 'savedListAll') {
    const { data, error } = await supabase.rpc('remove_members_from_saved_lead_list_for_list', {
      p_account_id: accountId,
      p_list_id: listId,
    });
    if (error) throw new Error(error.message);
    return { removed: parseRemoveApplyResult(data).removed };
  }

  if (scope.kind === 'savedListFiltered') {
    const params = savedListQueryToRpcParams(scope.query);
    const { data, error } = await supabase.rpc('remove_members_from_saved_lead_list_for_list_view', {
      p_account_id: accountId,
      p_list_id: listId,
      ...params,
    });
    if (error) throw new Error(error.message);
    return parseRemoveApplyResult(data);
  }

  if (scope.kind === 'explorerView') {
    const params = explorerQueryToRpcParams(scope.query);
    const { data, error } = await supabase.rpc('remove_explorer_view_from_saved_lead_list', {
      p_account_id: accountId,
      p_list_id: listId,
      ...params,
    });
    if (error) throw new Error(error.message);
    return parseRemoveApplyResult(data);
  }

  throw new Error('Unsupported list membership scope for apply.');
}
