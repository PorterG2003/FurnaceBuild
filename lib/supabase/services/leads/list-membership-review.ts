import { supabase } from '../../client';

export interface AddListMembershipReviewSummary {
  requested: number;
  alreadyMember: number;
  toAdd: number;
  notInAccount: number;
}

export interface RemoveListMembershipReviewSummary {
  requested: number;
  inList: number;
  toRemove: number;
  notInList: number;
}

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

export async function getAddListMembershipReviewSummary(
  accountId: string,
  listId: string,
  globalLeadIds: string[],
): Promise<AddListMembershipReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('saved_list_membership_review_summary', {
    p_account_id: accountId,
    p_list_id: listId,
    p_global_lead_ids: uniqueIds,
    p_mode: 'add',
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcAddReviewSummary;
  return {
    requested: summary.requested ?? 0,
    alreadyMember: summary.alreadyMember ?? 0,
    toAdd: summary.toAdd ?? 0,
    notInAccount: summary.notInAccount ?? 0,
  };
}

export async function getRemoveListMembershipReviewSummary(
  accountId: string,
  listId: string,
  globalLeadIds: string[],
): Promise<RemoveListMembershipReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('saved_list_membership_review_summary', {
    p_account_id: accountId,
    p_list_id: listId,
    p_global_lead_ids: uniqueIds,
    p_mode: 'remove',
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcRemoveReviewSummary;
  return {
    requested: summary.requested ?? 0,
    inList: summary.inList ?? 0,
    toRemove: summary.toRemove ?? 0,
    notInList: summary.notInList ?? 0,
  };
}
