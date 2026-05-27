import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import { CampaignDbHarness } from '../campaign/harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from '../campaign/fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function backfillRollup(harness: CampaignDbHarness) {
  await harness.supabase.rpc('backfill_account_lead_people_batch', {
    p_account_id: harness.env.accountId,
    p_limit: 500,
  });
}

async function createTestList(harness: CampaignDbHarness, memberIds: string[]) {
  const { data: listRow, error: listError } = await harness.supabase
    .from('lead_saved_lists')
    .insert({
      account_id: harness.env.accountId,
      name: `Membership test ${harness.namespace}`,
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

async function countMembers(harness: CampaignDbHarness, listId: string) {
  const { count, error } = await harness.supabase
    .from('lead_saved_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', harness.env.accountId)
    .eq('list_id', listId);

  assert.equal(error, null);
  return count ?? 0;
}

async function addMembersViaTables(
  harness: CampaignDbHarness,
  listId: string,
  globalLeadIds: string[],
) {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data: accountRows } = await harness.supabase
    .from('account_lead_people')
    .select('global_lead_id')
    .eq('account_id', harness.env.accountId)
    .in('global_lead_id', uniqueIds);

  const valid = new Set((accountRows ?? []).map((row) => row.global_lead_id as string));
  const { data: existingRows } = await harness.supabase
    .from('lead_saved_list_members')
    .select('global_lead_id')
    .eq('account_id', harness.env.accountId)
    .eq('list_id', listId)
    .in('global_lead_id', uniqueIds);

  const existing = new Set((existingRows ?? []).map((row) => row.global_lead_id as string));
  const toAdd = uniqueIds.filter((id) => valid.has(id) && !existing.has(id));

  if (toAdd.length > 0) {
    const { error } = await harness.supabase.from('lead_saved_list_members').insert(
      toAdd.map((globalLeadId) => ({
        list_id: listId,
        account_id: harness.env.accountId,
        global_lead_id: globalLeadId,
        source: 'manual' as const,
      })),
    );
    assert.equal(error, null);
  }

  return {
    added: toAdd.length,
    skippedAlreadyMember: uniqueIds.filter((id) => existing.has(id)).length,
    skippedInvalid: uniqueIds.filter((id) => !valid.has(id)).length,
  };
}

test('saved_list_membership_review_summary returns expected add counts', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-review-add') });
  let listId: string | null = null;

  try {
    const email = `review-add-${harness.namespace}@furnace.test`;
    await harness.createCampaignGraph({
      name: 'Review Add Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-0',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    await backfillRollup(harness);

    const globalLeadId = hashGlobalLeadId(email);
    listId = await createTestList(harness, []);

    const { data, error } = await harness.supabase.rpc('saved_list_membership_review_summary', {
      p_account_id: harness.env.accountId,
      p_list_id: listId,
      p_global_lead_ids: [globalLeadId],
      p_mode: 'add',
    });
    assert.equal(error, null);
    assert.equal((data as { requested: number }).requested, 1);
    assert.equal((data as { toAdd: number }).toAdd, 1);
    assert.equal((data as { alreadyMember: number }).alreadyMember, 0);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('addMembersToSavedLeadList inserts new members and skips duplicates', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-add-sel') });
  let listId: string | null = null;

  try {
    const emails = ['one', 'two'].map(
      (prefix) => `${prefix}-add-sel-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Add Selection Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `lead-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });
    await backfillRollup(harness);

    const globalLeadIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestList(harness, [globalLeadIds[0]!]);

    const first = await addMembersViaTables(harness, listId, globalLeadIds);
    assert.equal(first.added, 1);
    assert.equal(first.skippedAlreadyMember, 1);
    assert.equal(first.skippedInvalid, 0);
    assert.equal(await countMembers(harness, listId), 2);

    const second = await addMembersViaTables(harness, listId, globalLeadIds);
    assert.equal(second.added, 0);
    assert.equal(second.skippedAlreadyMember, 2);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('removeMembersFromSavedLeadList removes members and skips not-in-list', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-rem-sel') });
  let listId: string | null = null;

  try {
    const emails = ['keep', 'drop'].map(
      (prefix) => `${prefix}-rem-sel-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Remove Selection Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `lead-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });
    await backfillRollup(harness);

    const globalLeadIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestList(harness, globalLeadIds);

    const orphanId = hashGlobalLeadId(`orphan-rem-sel-${harness.namespace}@furnace.test`);
    const { data: removeReview, error: reviewError } = await harness.supabase.rpc(
      'saved_list_membership_review_summary',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_global_lead_ids: [globalLeadIds[1]!, orphanId],
        p_mode: 'remove',
      },
    );
    assert.equal(reviewError, null);
    assert.equal((removeReview as { toRemove: number }).toRemove, 1);
    assert.equal((removeReview as { notInList: number }).notInList, 1);

    const { error: deleteError } = await harness.supabase
      .from('lead_saved_list_members')
      .delete()
      .eq('account_id', harness.env.accountId)
      .eq('list_id', listId)
      .in('global_lead_id', [globalLeadIds[1]!]);
    assert.equal(deleteError, null);

    assert.equal(await countMembers(harness, listId), 1);
    const remaining = await harness.supabase
      .from('lead_saved_list_members')
      .select('global_lead_id')
      .eq('list_id', listId);
    assert.equal(remaining.data?.[0]?.global_lead_id, globalLeadIds[0]);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('explorer view search adds only matching leads to list membership', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-add-view') });
  let listId: string | null = null;

  try {
    const emails = ['alpha', 'beta'].map(
      (prefix) => `${prefix}-add-view-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Add View Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `lead-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });
    await backfillRollup(harness);

    listId = await createTestList(harness, []);

    const { data: pageRows, error: pageError } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_search: 'alpha-add-view',
      p_limit: 100,
      p_offset: 0,
    });
    assert.equal(pageError, null);
    assert.equal((pageRows ?? []).length, 1);

    const globalLeadIds = (pageRows ?? []).map((row) => (row as { global_lead_id: string }).global_lead_id);
    const result = await addMembersViaTables(harness, listId, globalLeadIds);
    assert.equal(result.added, 1);
    assert.equal(await countMembers(harness, listId), 1);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('removeSavedListPeopleView removes only filtered members', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-rem-filter') });
  let listId: string | null = null;

  try {
    const emails = ['aaa', 'bbb'].map(
      (prefix) => `${prefix}-rem-filter-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Remove Filtered Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `lead-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });
    await backfillRollup(harness);

    const globalLeadIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestList(harness, globalLeadIds);

    const { data: filteredRows, error: filterError } = await harness.supabase.rpc(
      'saved_lead_list_people_page',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_search: 'bbb-rem-filter',
        p_limit: 100,
        p_offset: 0,
      },
    );
    assert.equal(filterError, null);
    assert.equal((filteredRows ?? []).length, 1);

    const toRemove = (filteredRows ?? []).map(
      (row) => (row as { global_lead_id: string }).global_lead_id,
    );
    const { error: deleteError } = await harness.supabase
      .from('lead_saved_list_members')
      .delete()
      .eq('account_id', harness.env.accountId)
      .eq('list_id', listId)
      .in('global_lead_id', toRemove);
    assert.equal(deleteError, null);
    assert.equal(await countMembers(harness, listId), 1);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('removeAllFromSavedLeadList empties list membership', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-rem-all') });
  let listId: string | null = null;

  try {
    const email = `rem-all-${harness.namespace}@furnace.test`;
    await harness.createCampaignGraph({
      name: 'Remove All Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-0',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    await backfillRollup(harness);

    const globalLeadId = hashGlobalLeadId(email);
    listId = await createTestList(harness, [globalLeadId]);
    assert.equal(await countMembers(harness, listId), 1);

    const { error } = await harness.supabase
      .from('lead_saved_list_members')
      .delete()
      .eq('account_id', harness.env.accountId)
      .eq('list_id', listId);
    assert.equal(error, null);
    assert.equal(await countMembers(harness, listId), 0);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});
