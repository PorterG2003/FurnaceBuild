import assert from 'node:assert/strict';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import type { CampaignDbHarness } from '../campaign/harness';

export async function backfillAccountLeadPeople(harness: CampaignDbHarness) {
  await harness.supabase.rpc('backfill_account_lead_people_batch', {
    p_account_id: harness.env.accountId,
    p_limit: 500,
  });
}

export async function createTestSavedList(
  harness: CampaignDbHarness,
  memberIds: string[],
  nameSuffix = 'test',
) {
  const { data: listRow, error: listError } = await harness.supabase
    .from('lead_saved_lists')
    .insert({
      account_id: harness.env.accountId,
      name: `Saved list ${nameSuffix} ${harness.namespace}`,
      description: null,
      column_layout: DEFAULT_SAVED_LIST_COLUMNS as never,
    })
    .select('id')
    .single();

  assert.equal(listError, null);
  const listId = listRow!.id as string;

  if (memberIds.length > 0) {
    const { error: membersError } = await harness.supabase.from('lead_saved_list_members').insert(
      memberIds.map((globalLeadId) => ({
        list_id: listId,
        account_id: harness.env.accountId,
        global_lead_id: globalLeadId,
        source: 'selection' as const,
      })),
    );
    assert.equal(membersError, null);
  }

  return listId;
}

export async function countSavedListMembers(harness: CampaignDbHarness, listId: string) {
  const { count, error } = await harness.supabase
    .from('lead_saved_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', harness.env.accountId)
    .eq('list_id', listId);

  assert.equal(error, null);
  return count ?? 0;
}

export async function cleanupSavedList(harness: CampaignDbHarness, listId: string) {
  await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
  await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
}
