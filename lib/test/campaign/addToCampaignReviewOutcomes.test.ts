import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('add_to_campaign_review_summary returns expected counts', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('review-summary') });
  const emailA = `review-a-${harness.namespace}@furnace.test`;
  const emailB = `review-b-${harness.namespace}@furnace.test`;
  const idA = hashGlobalLeadId(emailA);
  const idB = hashGlobalLeadId(emailB);

  try {
    await harness.createCampaignGraph({
      name: 'Review Source Native',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'a',
          email: emailA,
          company_name: 'Acme',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'b',
          email: emailB,
          company_name: 'Beta',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Review Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'existing',
          email: emailA,
          company_name: 'Acme Target',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('add_to_campaign_review_summary', {
      p_account_id: harness.env.accountId,
      p_campaign_id: targetGraph.campaignId,
      p_global_lead_ids: [idA, idB],
    });
    assert.equal(error, null);

    const summary = data as Record<string, number>;
    assert.equal(summary.selectedPeople, 2);
    assert.equal(summary.alreadyInCampaign, 1);
    assert.equal(summary.membershipsInScope, 3);
    assert.ok(summary.nativeMemberships >= 3);
  } finally {
    await harness.cleanup();
  }
});

test('start_add_to_campaign_job and get_account_import_job are readable for harness account', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-job-rpc') });
  const email = `job-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Job RPC Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data: jobId, error: startError } = await harness.supabase.rpc('start_add_to_campaign_job', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(startError, null);
    assert.ok(jobId);

    const { data: job, error: getError } = await harness.supabase.rpc('get_account_import_job', {
      p_job_id: jobId,
    });
    assert.equal(getError, null);
    assert.equal((job as { status: string }).status, 'queued');
  } finally {
    await harness.cleanup();
  }
});
