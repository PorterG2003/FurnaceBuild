import { buildProductionLikeSeedSpecs } from '../../../lib/test/campaign/productionLikeSeed';
import { materializeCampaignGraph } from '../../../lib/test/campaign/harness';
import type { SeedModule } from '../types';

export const devDefaultScenarioModule: SeedModule = {
  id: 'devDefault_seed',
  description: 'Seed a production-like account slice with 5 campaigns and campaign-state coverage',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'dev-default requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).',
      );
    }

    const specs = buildProductionLikeSeedSpecs();
    const leadCount = specs.reduce((sum, spec) => sum + spec.leads.length, 0);
    const threadCount = specs.reduce(
      (sum, spec) => sum + spec.leads.filter((lead) => lead.thread != null).length,
      0,
    );

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would seed dev-default campaigns=${specs.length} leads=${leadCount} conversations=${threadCount}`,
      );
      return;
    }

    for (const spec of specs) {
      const graph = await materializeCampaignGraph({
        supabase: ctx.supabase,
        accountId,
        ownerUserId,
        spec,
        resetExistingCampaignSlice: true,
      });

      ctx.log(
        `dev-default seeded campaign=${graph.campaignId} leads=${spec.leads.length} threads=${spec.leads.filter((lead) => lead.thread != null).length}`,
      );
    }
  },
};
