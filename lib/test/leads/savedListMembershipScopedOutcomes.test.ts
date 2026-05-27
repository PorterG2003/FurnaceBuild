import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from '../campaign/harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from '../campaign/fixtures';
import {
  backfillAccountLeadPeople,
  cleanupSavedList,
  countSavedListMembers,
  createTestSavedList,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('remove all on saved list deletes every member via scoped RPC', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('scoped-remove-all') });
  let listId: string | null = null;

  try {
    const emails = ['a', 'b', 'c'].map((prefix) => `${prefix}-scoped-all-${harness.namespace}@furnace.test`);
    await harness.createCampaignGraph({
      name: 'Scoped Remove All',
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
    await backfillAccountLeadPeople(harness);

    const memberIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestSavedList(harness, memberIds, 'remove-all');

    const { data: review, error: reviewError } = await harness.supabase.rpc(
      'saved_list_membership_review_summary_for_list',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_mode: 'remove',
      },
    );
    assert.equal(reviewError, null);
    assert.equal((review as { toRemove: number }).toRemove, 3);

    const { data: applyResult, error: applyError } = await harness.supabase.rpc(
      'remove_members_from_saved_lead_list_for_list',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
      },
    );
    assert.equal(applyError, null);
    assert.equal((applyResult as { removed: number }).removed, 3);
    assert.equal(await countSavedListMembers(harness, listId), 0);
  } finally {
    if (listId) await cleanupSavedList(harness, listId);
    await harness.cleanup();
  }
});

test('add explorer view to saved list adds only matching account people', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('scoped-explorer-add') });
  let listId: string | null = null;

  try {
    const emails = ['match-me', 'other-lead'].map(
      (prefix) => `${prefix}-scoped-add-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Scoped Explorer Add',
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
    await backfillAccountLeadPeople(harness);

    listId = await createTestSavedList(harness, [], 'explorer-add');
    const search = `match-me-scoped-add-${harness.namespace}`;

    const { data: review, error: reviewError } = await harness.supabase.rpc(
      'saved_list_membership_review_summary_for_explorer_view',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_mode: 'add',
        p_search: search,
      },
    );
    assert.equal(reviewError, null);
    assert.equal((review as { requested: number }).requested, 1);
    assert.equal((review as { toAdd: number }).toAdd, 1);

    const { data: applyResult, error: applyError } = await harness.supabase.rpc(
      'add_members_to_saved_lead_list_for_explorer_view',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_search: search,
      },
    );
    assert.equal(applyError, null);
    assert.equal((applyResult as { added: number }).added, 1);
    assert.equal(await countSavedListMembers(harness, listId), 1);
  } finally {
    if (listId) await cleanupSavedList(harness, listId);
    await harness.cleanup();
  }
});

test('remove filtered on saved list deletes only matching members', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('scoped-list-filter') });
  let listId: string | null = null;

  try {
    const emails = ['filter-aaa', 'filter-bbb'].map(
      (prefix) => `${prefix}-scoped-filter-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Scoped List Filter',
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
    await backfillAccountLeadPeople(harness);

    const memberIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestSavedList(harness, memberIds, 'list-filter');

    const { data: applyResult, error: applyError } = await harness.supabase.rpc(
      'remove_members_from_saved_lead_list_for_list_view',
      {
        p_account_id: harness.env.accountId,
        p_list_id: listId,
        p_search: 'filter-aaa',
      },
    );
    assert.equal(applyError, null);
    assert.equal((applyResult as { removed: number }).removed, 1);
    assert.equal(await countSavedListMembers(harness, listId), 1);

    const { data: remaining } = await harness.supabase
      .from('lead_saved_list_members')
      .select('global_lead_id')
      .eq('list_id', listId);
    assert.equal(remaining?.[0]?.global_lead_id, memberIds[1]);
  } finally {
    if (listId) await cleanupSavedList(harness, listId);
    await harness.cleanup();
  }
});
