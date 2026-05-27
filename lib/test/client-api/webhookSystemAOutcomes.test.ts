import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
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

test('async add_to_campaign job emits one lead.added_to_campaign.completed and no row lead events', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-system-a-add'),
  });
  const email = `system-a-add-${harness.namespace}@example.com`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const sourceGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'System A Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    const targetGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'System A Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { data: job, error: insertError } = await harness.supabase
      .from('api_import_jobs')
      .insert({
        account_id: harness.accountId,
        campaign_id: targetGraph.campaignId,
        status: 'queued',
        progress: 0,
        cursor: 0,
        input: {
          operation: 'add_to_campaign',
          global_lead_ids: [globalLeadId],
        },
        result: {},
        errors: [],
      } as never)
      .select('id')
      .single();
    assert.equal(insertError, null);

    await processImportJobById(job!.id as string, { supabase: harness.supabase as never });

    const { data: events } = await harness.supabase
      .from('webhook_events')
      .select('event_type')
      .eq('account_id', harness.accountId)
      .gte('created_at', harness.startedAt);
    const eventTypes = (events ?? []).map((row) => row.event_type);
    assert.equal(eventTypes.filter((type) => type === 'lead.added_to_campaign.completed').length, 1);
    assert.equal(eventTypes.filter((type) => type === 'lead.created' || type === 'lead.updated').length, 0);
    void sourceGraph;
  } finally {
    await harness.cleanup();
  }
});

test('sync bulk import emits one lead.bulk_import.completed and no per-row lead events', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-system-a-bulk'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'System A Bulk',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const emailA = `bulk-a-${harness.namespace}@example.com`;
    const emailB = `bulk-b-${harness.namespace}@example.com`;

    const response = await harness.request(`/v1/campaigns/${graph.campaignId}/leads/bulk`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        leads: [
          { email: emailA, first_name: 'A' },
          { email: emailB, first_name: 'B' },
        ],
      },
    });
    assert.equal(response.status, 200);

    const { data: events } = await harness.supabase
      .from('webhook_events')
      .select('event_type')
      .eq('account_id', harness.accountId)
      .eq('campaign_id', graph.campaignId);
    const eventTypes = (events ?? []).map((row) => row.event_type);
    assert.equal(eventTypes.filter((type) => type === 'lead.bulk_import.completed').length, 1);
    assert.equal(eventTypes.filter((type) => type === 'lead.created' || type === 'lead.updated').length, 0);
  } finally {
    await harness.cleanup();
  }
});
