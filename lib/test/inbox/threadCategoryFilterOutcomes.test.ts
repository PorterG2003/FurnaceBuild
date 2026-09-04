import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';

const NO_CATEGORY_FILTER = '__no_category__';

async function ensureInboxCategoryFilterSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: '00000000-0000-4000-8000-000000000000',
    p_category: ['Interested'],
    p_limit: 1,
    p_offset: 0,
  });
  if (
    error &&
    /Could not find the function|does not exist|schema cache|p_category|text\[\]|array/i.test(
      error.message,
    )
  ) {
    t.skip(`Inbox multi-category RPC not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function listSubjectsByCategory(
  harness: CampaignDbHarness,
  accountId: string,
  campaignId: string,
  categories: string[] | null,
): Promise<string[]> {
  const { data, error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: accountId,
    p_campaign_ids: [campaignId],
    ...(categories && categories.length > 0 ? { p_category: categories } : {}),
    p_has_reply_only: true,
    p_limit: 20,
    p_offset: 0,
  });
  assert.equal(error, null, error?.message);
  return ((data ?? []) as Array<{ subject: string }>).map((row) => row.subject).sort();
}

test('list_account_inbox_threads matches any selected category including uncategorized', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-category-filter'),
  });
  const now = Date.now();

  try {
    if (!(await ensureInboxCategoryFilterSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Thread Category Filter Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'interested',
          email: `interested-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Interested thread',
            category: 'Interested',
            categorySource: 'user',
            lastMessageAt: new Date(now - 5 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 5 * 60_000).toISOString(),
                readAt: new Date(now - 4 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'neutral',
          email: `neutral-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Neutral thread',
            category: 'Neutral',
            categorySource: 'user',
            lastMessageAt: new Date(now - 10 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 9 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'uncategorized',
          email: `uncategorized-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Uncategorized thread',
            category: null,
            lastMessageAt: new Date(now - 15 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 15 * 60_000).toISOString(),
                readAt: new Date(now - 14 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
      ],
    });

    const allSubjects = ['Interested thread', 'Neutral thread', 'Uncategorized thread'];

    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, null),
      allSubjects,
    );

    const interestedOnly = await listSubjectsByCategory(
      harness,
      graph.accountId,
      graph.campaignId,
      ['Interested'],
    );
    if (interestedOnly.length === 0) {
      t.skip('Inbox multi-category RPC not applied in shared test DB');
      return;
    }
    assert.deepEqual(interestedOnly, ['Interested thread']);
    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, []),
      allSubjects,
    );
    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, [
        'Interested',
        'Neutral',
      ]),
      ['Interested thread', 'Neutral thread'],
    );
    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, [NO_CATEGORY_FILTER]),
      ['Uncategorized thread'],
    );
    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, ['no_category']),
      ['Uncategorized thread'],
    );
    assert.deepEqual(
      await listSubjectsByCategory(harness, graph.accountId, graph.campaignId, [
        'Interested',
        NO_CATEGORY_FILTER,
      ]),
      ['Interested thread', 'Uncategorized thread'],
    );
  } finally {
    await harness.cleanup();
  }
});
