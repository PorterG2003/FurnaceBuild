import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from '../campaign/harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from '../campaign/fixtures';
import {
  backfillAccountLeadPeople,
  cleanupSavedList,
  createTestSavedList,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('add_to_campaign_review_summary_for_list counts every list member', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('campaign-list-review') });
  let listId: string | null = null;

  try {
    const emails = ['one', 'two'].map(
      (prefix) => `${prefix}-camp-list-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Review Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `src-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });
    await backfillAccountLeadPeople(harness);

    const targetGraph = await harness.createCampaignGraph({
      name: 'Review Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const memberIds = emails.map((email) => hashGlobalLeadId(email));
    listId = await createTestSavedList(harness, memberIds, 'campaign-review');

    const { data, error } = await harness.supabase.rpc('add_to_campaign_review_summary_for_list', {
      p_account_id: harness.env.accountId,
      p_campaign_id: targetGraph.campaignId,
      p_list_id: listId,
    });
    assert.equal(error, null);
    assert.equal((data as { selectedPeople: number }).selectedPeople, 2);
    assert.equal((data as { alreadyInCampaign: number }).alreadyInCampaign, 0);
  } finally {
    if (listId) await cleanupSavedList(harness, listId);
    await harness.cleanup();
  }
});

test('pause_enrollments_review_summary_for_list matches selection review for list members', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('pause-list-review') });
  let listId: string | null = null;

  try {
    const email = `pause-list-${harness.namespace}@furnace.test`;
    const graph = await harness.createCampaignGraph({
      name: 'Pause List Review',
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
    await backfillAccountLeadPeople(harness);

    const memberId = hashGlobalLeadId(email);
    listId = await createTestSavedList(harness, [memberId], 'pause-review');

    const { data: forList, error: forListError } = await harness.supabase.rpc(
      'pause_enrollments_review_summary_for_list',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_list_id: listId,
      },
    );
    assert.equal(forListError, null);

    const { data: forIds, error: forIdsError } = await harness.supabase.rpc(
      'pause_enrollments_review_summary',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_global_lead_ids: [memberId],
      },
    );
    assert.equal(forIdsError, null);

    assert.equal(
      (forList as { activeInCampaign: number }).activeInCampaign,
      (forIds as { activeInCampaign: number }).activeInCampaign,
    );
    assert.equal(
      (forList as { selectedPeople: number }).selectedPeople,
      (forIds as { selectedPeople: number }).selectedPeople,
    );
  } finally {
    if (listId) await cleanupSavedList(harness, listId);
    await harness.cleanup();
  }
});
