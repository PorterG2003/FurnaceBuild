import type { SeedModule } from '../../types';
import { DEFAULT_SEED_CAMPAIGN_ID } from '../../constants/campaignSmoke';
import { resetCampaignSmokeStore, campaignSmokeStore } from './store';

export const campaignSmokeEnvModule: SeedModule = {
  id: 'campaignSmoke_env',
  description: 'Validate SEED_ACCOUNT_ID / SEED_OWNER_USER_ID and reset scenario store',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'campaign-smoke requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing users.id / auth user id and account membership).'
      );
    }

    resetCampaignSmokeStore();
    campaignSmokeStore.accountId = accountId;
    campaignSmokeStore.ownerUserId = ownerUserId;
    campaignSmokeStore.campaignId =
      process.env.SEED_CAMPAIGN_ID?.trim() || DEFAULT_SEED_CAMPAIGN_ID;

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would use accountId=${accountId} ownerUserId=${ownerUserId} campaignId=${campaignSmokeStore.campaignId}`
      );
    }
  },
};
