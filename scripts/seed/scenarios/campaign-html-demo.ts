import { randomUUID } from 'node:crypto';
import { CAMPAIGN_HTML_QA_SAMPLES } from '../../../lib/email/campaignHtmlQaSamples';
import type { Json } from '../../../lib/supabase/types/database';
import { materializeCampaignGraph } from '../../../lib/test/campaign/harness';
import type { SeedModule } from '../types';

function buildHtmlDemoFlowData(): Json {
  const [lightSample, mediumSample, heavySample] = CAMPAIGN_HTML_QA_SAMPLES;
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Lead Source' },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 260, y: 0 },
        data: {
          label: 'HTML Demo Email',
          variants: [
            {
              id: '10000000-0000-4000-8000-000000000001',
              label: 'A',
              subject: lightSample.subject,
              template: lightSample.bodyText,
              body_html: lightSample.bodyHtml,
              body_text: lightSample.bodyText,
              editor_mode: 'html',
              isActive: true,
              order: 0,
            },
            {
              id: '10000000-0000-4000-8000-000000000002',
              label: 'B',
              subject: mediumSample.subject,
              template: mediumSample.bodyText,
              body_html: mediumSample.bodyHtml,
              body_text: mediumSample.bodyText,
              editor_mode: 'html',
              isActive: true,
              order: 1,
            },
            {
              id: '10000000-0000-4000-8000-000000000003',
              label: 'C',
              subject: heavySample.subject,
              template: heavySample.bodyText,
              body_html: heavySample.bodyHtml,
              body_text: heavySample.bodyText,
              editor_mode: 'html',
              isActive: true,
              order: 2,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  } as Json;
}

export const campaignHtmlDemoSeedModule: SeedModule = {
  id: 'campaignHtmlDemo_seed',
  description: 'Seed a campaign with light, medium, and heavy HTML variants',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error('campaign-html-demo requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID.');
    }

    const namespace = `html-demo-${process.env.SEED_SCENARIO_NAMESPACE?.trim() || 'default'}`;
    const name = `HTML Email Demo ${namespace}`;
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would seed ${name}`);
      return;
    }

    const graph = await materializeCampaignGraph({
      supabase: ctx.supabase,
      accountId,
      ownerUserId,
      resetExistingCampaignSlice: true,
      spec: {
        namespace,
        name,
        status: 'running',
        flowKind: 'emailOnly',
        mailboxes: [
          {
            key: 'demo-mailbox',
            emailAddress: `html-demo-${namespace}@example.com`,
            displayName: 'HTML Demo Sender',
          },
        ],
        leads: [
          {
            key: 'lead-a',
            email: `html-demo-a-${randomUUID().slice(0, 8)}@example.com`,
            firstName: 'Alex',
            companyName: 'Northwind',
            enrollment: {
              state: 'active',
              currentFlowNodeId: 'email-1',
              nextRunAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
          {
            key: 'lead-b',
            email: `html-demo-b-${randomUUID().slice(0, 8)}@example.com`,
            firstName: 'Jordan',
            companyName: 'Aperture Labs',
            enrollment: {
              state: 'active',
              currentFlowNodeId: 'email-1',
              nextRunAt: new Date(Date.now() + 120_000).toISOString(),
            },
          },
        ],
      },
    });

    const flowData = buildHtmlDemoFlowData();
    const now = new Date().toISOString();
    const { error } = await ctx.supabase
      .from('campaigns')
      .update({
        flow_data: flowData,
        updated_at: now,
      })
      .eq('id', graph.campaignId);

    if (error) {
      throw new Error(`campaign-html-demo: failed to update flow_data: ${error.message}`);
    }

    ctx.log(`campaign-html-demo seeded campaign=${graph.campaignId}`);
  },
};
