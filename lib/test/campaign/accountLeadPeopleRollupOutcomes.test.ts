import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from './fixtures';
import { callAddGlobalLeadsToCampaignRpc, loadRollupRow } from './add-to-campaign-rpc-helpers';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('rollup row is created after add-to-campaign RPC', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rollup-create') });
  const email = `rollup-create-${harness.namespace}@furnace.test`;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Rollup Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email,
          company_name: 'Acme',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Rollup Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const sourceLeadId = sourceGraph.leadsByKey.get('source')!.leadId;
    const { data: sourceLead } = await harness.supabase
      .from('leads')
      .select('global_lead_id')
      .eq('id', sourceLeadId)
      .single();
    const globalLeadId = sourceLead!.global_lead_id as string;

    await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    const rollup = await loadRollupRow(harness, globalLeadId);
    assert.ok(rollup);
    assert.equal(rollup!.email, email);
    assert.ok(Number(rollup!.campaign_count) >= 2);
    assert.ok(rollup!.company_list);
  } finally {
    await harness.cleanup();
  }
});

test('rollup campaign_count increments when second membership is added', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rollup-count') });
  const email = `rollup-count-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    await harness.createCampaignGraph({
      name: 'Rollup Count A',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'a',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Rollup Count B',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const before = await loadRollupRow(harness, globalLeadId);
    assert.ok(before);
    assert.equal(Number(before!.campaign_count), 1);

    await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    const after = await loadRollupRow(harness, globalLeadId);
    assert.ok(after);
    assert.equal(Number(after!.campaign_count), 2);
  } finally {
    await harness.cleanup();
  }
});

test('rollup matches account_lead_people_page total for scoped ids', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rollup-page') });
  const email = `rollup-page-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    await harness.createCampaignGraph({
      name: 'Rollup Page',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'person',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data: pageRows, error } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(error, null);
    assert.equal((pageRows ?? []).length, 1);
    assert.equal((pageRows?.[0] as { total_count: number }).total_count, 1);
  } finally {
    await harness.cleanup();
  }
});
