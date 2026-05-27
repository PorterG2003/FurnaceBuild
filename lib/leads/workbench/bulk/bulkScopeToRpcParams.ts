import type { AccountLeadExplorerQuery } from '@/lib/supabase/services/leads/account-leads';
import type { SavedLeadListPeopleQuery } from '@/lib/supabase/services/leads/saved-lists';
import type { BulkScope } from './bulkScope';

export type ExplorerScopeRpcParams = {
  p_campaign_ids: string[] | null;
  p_reply_statuses: string[] | null;
  p_enrollment_states: string[] | null;
  p_reply_categories: string[] | null;
  p_search: string | null;
  p_global_lead_ids: string[] | null;
};

export type SavedListViewScopeRpcParams = {
  p_campaign_ids: string[] | null;
  p_reply_statuses: string[] | null;
  p_enrollment_states: string[] | null;
  p_reply_categories: string[] | null;
  p_search: string | null;
};

export function explorerQueryToRpcParams(
  query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>,
): ExplorerScopeRpcParams {
  return {
    p_campaign_ids: query.campaignIds?.length ? query.campaignIds : null,
    p_reply_statuses: query.replyStatuses?.length ? query.replyStatuses : null,
    p_enrollment_states: query.enrollmentStates?.length ? query.enrollmentStates : null,
    p_reply_categories: query.replyCategories?.length ? query.replyCategories : null,
    p_search: query.searchQuery?.trim() ? query.searchQuery.trim() : null,
    p_global_lead_ids: query.globalLeadIds?.length ? query.globalLeadIds : null,
  };
}

export function savedListQueryToRpcParams(
  query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>,
): SavedListViewScopeRpcParams {
  return {
    p_campaign_ids: query.campaignIds?.length ? query.campaignIds : null,
    p_reply_statuses: query.replyStatuses?.length ? query.replyStatuses : null,
    p_enrollment_states: query.enrollmentStates?.length ? query.enrollmentStates : null,
    p_reply_categories: query.replyCategories?.length ? query.replyCategories : null,
    p_search: query.searchQuery?.trim() ? query.searchQuery.trim() : null,
  };
}

export type ListMembershipReviewRpc =
  | { rpc: 'saved_list_membership_review_summary'; params: { p_global_lead_ids: string[]; p_mode: 'add' | 'remove' } }
  | {
      rpc: 'saved_list_membership_review_summary_for_list';
      params: { p_mode: 'add' | 'remove' };
    }
  | {
      rpc: 'saved_list_membership_review_summary_for_list_view';
      params: SavedListViewScopeRpcParams & { p_mode: 'add' | 'remove' };
    }
  | {
      rpc: 'saved_list_membership_review_summary_for_explorer_view';
      params: ExplorerScopeRpcParams & { p_mode: 'add' | 'remove' };
    };

export function listMembershipReviewRpcForScope(
  scope: BulkScope,
  mode: 'add' | 'remove',
): ListMembershipReviewRpc {
  switch (scope.kind) {
    case 'selection':
      return {
        rpc: 'saved_list_membership_review_summary',
        params: { p_global_lead_ids: scope.globalLeadIds, p_mode: mode },
      };
    case 'savedListAll':
      return {
        rpc: 'saved_list_membership_review_summary_for_list',
        params: { p_mode: mode },
      };
    case 'savedListFiltered':
      return {
        rpc: 'saved_list_membership_review_summary_for_list_view',
        params: { ...savedListQueryToRpcParams(scope.query), p_mode: mode },
      };
    case 'explorerView':
      return {
        rpc: 'saved_list_membership_review_summary_for_explorer_view',
        params: { ...explorerQueryToRpcParams(scope.query), p_mode: mode },
      };
  }
}

export type CampaignReviewForListRpc =
  | 'add_to_campaign_review_summary_for_list'
  | 'pause_enrollments_review_summary_for_list'
  | 'resume_enrollments_review_summary_for_list'
  | 'remove_from_campaign_review_summary_for_list'
  | 'remove_from_all_campaigns_review_summary_for_list';

export function campaignReviewForListRpc(operation: CampaignReviewForListRpc): CampaignReviewForListRpc {
  return operation;
}

export function requiresListIdForReview(scope: BulkScope): string | null {
  if (scope.kind === 'savedListAll' || scope.kind === 'savedListFiltered') {
    return scope.listId;
  }
  return null;
}
