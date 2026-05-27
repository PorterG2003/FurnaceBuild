import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { stableGlobalLeadIdsKey } from '../../client-api/webhooks/batchCompletion.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
} from '../campaign/fixtures.js';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('client api sync pause emits one enrollment.pause_completed webhook with stable dedupe', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('enrollment-pause'),
  });

  try {
    const email = `pause-${harness.namespace}@example.com`;
    const globalLeadId = hashGlobalLeadId(email);
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Pause Enrollments',
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
    const apiKey = await harness.createApiKey();

    const response = await harness.request(`/v1/campaigns/${graph.campaignId}/enrollments/pause`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { global_lead_ids: [globalLeadId] },
    });
    assert.equal(response.status, 200);

    const expectedDedupe = `enrollment.pause_completed:sync:${graph.campaignId}:${stableGlobalLeadIdsKey([globalLeadId])}`;
    const { data: events, error } = await harness.supabase
      .from('webhook_events')
      .select('event_type, dedupe_key, payload')
      .eq('account_id', harness.accountId)
      .eq('campaign_id', graph.campaignId);
    assert.equal(error, null);
    assert.equal(events?.length, 1);
    assert.equal(events?.[0]?.event_type, 'enrollment.pause_completed');
    assert.equal(events?.[0]?.dedupe_key, expectedDedupe);
    const payload = events?.[0]?.payload as { source?: string; operation?: string };
    assert.equal(payload.source, 'sync');
    assert.equal(payload.operation, 'pause_enrollments');
  } finally {
    await harness.cleanup();
  }
});

test('client api sync resume emits enrollment.resume_completed webhook', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('enrollment-resume'),
  });

  try {
    const email = `resume-${harness.namespace}@example.com`;
    const globalLeadId = hashGlobalLeadId(email);
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Resume Enrollments',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'paused' }),
        }),
      ],
    });
    const apiKey = await harness.createApiKey();

    const response = await harness.request(`/v1/campaigns/${graph.campaignId}/enrollments/resume`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { global_lead_ids: [globalLeadId] },
    });
    assert.equal(response.status, 200);

    const { data: events } = await harness.supabase
      .from('webhook_events')
      .select('event_type')
      .eq('account_id', harness.accountId)
      .eq('campaign_id', graph.campaignId);
    assert.equal(events?.length, 1);
    assert.equal(events?.[0]?.event_type, 'enrollment.resume_completed');
  } finally {
    await harness.cleanup();
  }
});
