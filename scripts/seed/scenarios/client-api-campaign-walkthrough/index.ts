import { materializeCampaignGraph } from '../../../lib/test/campaign/harness.js';
import type { SeedModule } from '../types.js';

export const clientApiCampaignWalkthroughModule: SeedModule = {
  id: 'clientApiWalkthrough_seed',
  description: 'Draft campaign + mailbox + linear flow + mixed leads for Client API v1.4 walkthrough',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error('client-api-campaign-walkthrough requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID.');
    }

    if (ctx.dryRun) {
      ctx.log('[dry-run] would seed API Walkthrough draft campaign with 4 leads');
      return;
    }

    const graph = await materializeCampaignGraph({
      supabase: ctx.supabase,
      accountId,
      ownerUserId,
      resetExistingCampaignSlice: true,
      spec: {
        namespace: ctx.scenarioId,
        name: 'API Walkthrough',
        status: 'draft',
        flowKind: 'emailOnly',
        leadSourceCustomFieldKeys: ['company'],
        mailboxes: [{
          key: 'walkthrough-mailbox',
          emailAddress: `api-walkthrough-${ctx.scenarioId}@example.com`,
          displayName: 'API Walkthrough Sender',
        }],
        leads: [
          { key: 'lead-1', email: `complete-1-${ctx.scenarioId}@example.com`, firstName: 'Alex', lastName: 'Complete', companyName: 'Acme' },
          { key: 'lead-2', email: `complete-2-${ctx.scenarioId}@example.com`, firstName: 'Blake', lastName: 'Complete', companyName: 'Beta Co' },
          { key: 'lead-3', email: `complete-3-${ctx.scenarioId}@example.com`, firstName: 'Casey', lastName: 'Complete', companyName: 'Gamma LLC' },
          { key: 'lead-4', email: `incomplete-${ctx.scenarioId}@example.com`, firstName: 'Dana', lastName: 'Incomplete' },
        ],
      },
    });

    const mailboxId = graph.mailboxIdsByKey.get('walkthrough-mailbox');
    ctx.log('client-api-campaign-walkthrough seeded:');
    ctx.log(`  campaign_id=${graph.campaignId}`);
    ctx.log(`  mailbox_id=${mailboxId ?? 'missing'}`);
    ctx.log(`  leads=${graph.leadsByKey.size}`);
    ctx.log('See scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md for curl checklist.');
  },
};
