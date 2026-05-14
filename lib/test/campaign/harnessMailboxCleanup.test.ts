import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from './fixtures';

test('CampaignDbHarness cleanup soft-deletes mailboxes linked to the campaign even when email_address was mutated', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('mb-email-mutate') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Mailbox Cleanup Mutate',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'solo',
          email: `solo-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            currentFlowNodeId: 'email-1',
          }),
        }),
      ],
    });

    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1');
    assert.ok(mailboxId);

    const { error: mutateError } = await harness.supabase
      .from('mailboxes')
      .update({ email_address: 'failure-deadbeef@example.com' } as any)
      .eq('id', mailboxId);
    assert.equal(mutateError, null);

    await harness.cleanup();

    const { data: row, error: reloadError } = await harness.supabase
      .from('mailboxes')
      .select('deleted_at, status')
      .eq('id', mailboxId)
      .maybeSingle();
    assert.equal(reloadError, null);
    assert.ok(row?.deleted_at, 'expected mailbox soft-deleted after cleanup despite mutated email_address');
    assert.equal(row?.status, 'disconnected');
  } finally {
    await harness.cleanup();
  }
});
