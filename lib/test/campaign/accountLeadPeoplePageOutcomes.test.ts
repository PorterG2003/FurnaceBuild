import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('account_lead_people_page pagination returns stable total_count', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('people-page') });

  try {
    const emails = [0, 1, 2].map((index) => `page-${index}-${harness.namespace}@furnace.test`);
    await harness.createCampaignGraph({
      name: 'People Page Campaign',
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

    for (const email of emails) {
      await harness.supabase.rpc('backfill_account_lead_people_batch', {
        p_account_id: harness.env.accountId,
        p_limit: 500,
      });
      void email;
    }

    const globalLeadIds = emails.map((email) => hashGlobalLeadId(email));
    const { data: page1, error: page1Error } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: globalLeadIds,
      p_limit: 2,
      p_offset: 0,
      p_sort_column: 'rollup-activity',
      p_sort_direction: 'desc',
    });
    assert.equal(page1Error, null);
    assert.equal((page1 ?? []).length, 2);
    assert.equal((page1?.[0] as { total_count: number }).total_count, 3);

    const { data: page2, error: page2Error } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: globalLeadIds,
      p_limit: 2,
      p_offset: 2,
      p_sort_column: 'rollup-activity',
      p_sort_direction: 'desc',
    });
    assert.equal(page2Error, null);
    assert.equal((page2 ?? []).length, 1);

    const page1Ids = new Set((page1 ?? []).map((row) => (row as { global_lead_id: string }).global_lead_id));
    const page2Ids = new Set((page2 ?? []).map((row) => (row as { global_lead_id: string }).global_lead_id));
    for (const id of page2Ids) {
      assert.equal(page1Ids.has(id), false);
    }
  } finally {
    await harness.cleanup();
  }
});
