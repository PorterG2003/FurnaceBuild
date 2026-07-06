import {
  buildDemoHubSeedSpecs,
  DEMO_HERO_THREAD_KEYS,
  getDemoHubSeedSummary,
  getDemoHubStatTargetForCampaign,
} from '../../../lib/test/campaign/demoHubSeed';
import { materializeCampaignGraph } from '../../../lib/test/campaign/harness';
import { applyDemoHubCampaignStats } from '../../../lib/test/campaign/seedCampaignStats';
import type { SeedModule } from '../types';

function previewOrigin(): string {
  return process.env.SEED_PREVIEW_ORIGIN?.trim() || '';
}

export const demoHubScenarioModule: SeedModule = {
  id: 'demoHub_seed',
  description: 'Seed Porter Gardiner demo account (~3k leads, ~40 inbox threads, realistic stats)',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error('demo-hub requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).');
    }

    const summary = getDemoHubSeedSummary();
    const specs = buildDemoHubSeedSpecs();

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would seed demo-hub campaigns=${summary.campaignCount} leads=${summary.totalLeads} threads=${summary.totalThreads} mailboxes=${summary.mailboxEmails.length}`,
      );
      for (const target of summary.statTargets) {
        ctx.log(
          `[dry-run] campaign=${target.campaignId} stats sent=${target.sent} replied=${target.replied} positive=${target.positive}`,
        );
      }
      return;
    }

    let heroThreadId: string | null = null;

    for (const spec of specs) {
      ctx.log(`demo-hub seeding campaign=${spec.name} leads=${spec.leads.length}`);
      const graph = await materializeCampaignGraph({
        supabase: ctx.supabase,
        accountId,
        ownerUserId,
        spec,
        resetExistingCampaignSlice: true,
      });

      const threadCount = spec.leads.filter((lead) => lead.thread != null).length;
      ctx.log(`demo-hub materialized campaign=${graph.campaignId} threads=${threadCount}`);

      const statTarget = getDemoHubStatTargetForCampaign(graph.campaignId);
      if (statTarget && statTarget.targetSent > 0) {
        const stats = await applyDemoHubCampaignStats(ctx.supabase, {
          campaignId: graph.campaignId,
          accountId,
          targetSent: statTarget.targetSent,
          replyRate: statTarget.replyRate,
          positiveShareOfReplies: statTarget.positiveShareOfReplies,
        });
        ctx.log(
          `demo-hub stats campaign=${graph.campaignId} sent=${stats.sent} replied=${stats.replied} positive=${stats.positive}`,
        );
      }

      const heroLead = graph.leadsByKey.get(DEMO_HERO_THREAD_KEYS.interested);
      if (heroLead?.threadId) {
        heroThreadId = heroLead.threadId;
      }
    }

    const origin = previewOrigin();
    const paths = ['/campaigns', '/inbox', '/senders'];
    ctx.log('demo-hub deep links:');
    for (const path of paths) {
      ctx.log(`  ${origin}${path}`);
    }
    if (heroThreadId) {
      ctx.log(`  ${origin}/inbox/${heroThreadId}  (hero interested thread)`);
    }
  },
};
