import test from 'node:test';
import assert from 'node:assert/strict';
import { leadWebhookIdentityFromRow } from '../../webhooks/leadWebhookIdentity.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import { ensureWebhookInfrastructureSchema } from './webhook-outcome-helpers.js';

test('private_lead_webhook_identity matches the TypeScript builder', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-identity-parity'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const { data: probe, error: probeError } = await harness.supabase.rpc(
      'private_lead_webhook_identity',
      {
        p_lead_id: '00000000-0000-4000-8000-000000000001',
        p_campaign_id: null,
        p_mailbox_id: null,
      },
    );
    if (probeError) {
      t.skip(`private_lead_webhook_identity unavailable: ${probeError.message}`);
      return;
    }
    void probe;

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: `Parity ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        {
          key: 'lead-1',
          email: `lead-${harness.namespace}@example.com`,
          firstName: 'Casey',
          lastName: 'Reed',
          companyName: 'Wasatch Corridor',
          mailboxKey: 'mailbox-1',
          enrollment: {
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date().toISOString(),
          },
        },
      ],
    });

    const leadId = graph.leadsByKey.get('lead-1')!.leadId;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const { error: updateError } = await harness.supabase
      .from('leads')
      .update({
        website: 'https://wasatch.example',
        linkedin_url: 'https://linkedin.com/in/casey-reed',
        company_linkedin_url: 'https://linkedin.com/company/wasatch',
        phone_number: '8015550100',
        custom_lead_data: {
          title: 'VP Sales',
          region: 'west',
          email: 'spoof@example.com',
          nested: { city: 'Ogden' },
        },
      } as never)
      .eq('id', leadId);
    assert.equal(updateError, null);

    const { data: lead, error: leadError } = await harness.supabase
      .from('leads')
      .select(
        'id, email, first_name, last_name, name, company_name, website, linkedin_url, company_linkedin_url, phone_number, custom_lead_data',
      )
      .eq('id', leadId)
      .single();
    assert.equal(leadError, null);

    const { data: campaign } = await harness.supabase
      .from('campaigns')
      .select('name')
      .eq('id', graph.campaignId)
      .single();
    const { data: mailbox } = await harness.supabase
      .from('mailboxes')
      .select('email_address')
      .eq('id', mailboxId)
      .single();

    const tsIdentity = leadWebhookIdentityFromRow({
      campaignId: graph.campaignId,
      campaignName: campaign?.name,
      lead: lead as never,
      mailboxId,
      mailboxEmail: mailbox?.email_address,
    });

    const { data: sqlIdentity, error: sqlError } = await harness.supabase.rpc(
      'private_lead_webhook_identity',
      {
        p_lead_id: leadId,
        p_campaign_id: graph.campaignId,
        p_mailbox_id: mailboxId,
      },
    );
    assert.equal(sqlError, null);
    assert.deepEqual(sqlIdentity, tsIdentity);
  } finally {
    await harness.cleanup();
  }
});
