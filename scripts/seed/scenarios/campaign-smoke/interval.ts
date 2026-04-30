import type { SeedModule } from '../../types';
import { SMOKE_INTERVAL_TIME_ISO } from '../../constants/campaignSmoke';
import { campaignSmokeStore } from './store';

export const campaignSmokeIntervalModule: SeedModule = {
  id: 'campaignSmoke_interval',
  description: 'Upsert deterministic campaign_intervals row',
  deps: ['campaignSmoke_leadsEnrollments'],
  async run(ctx) {
    const { supabase } = ctx;
    const { campaignId, accountId } = campaignSmokeStore;

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would upsert campaign_intervals campaign=${campaignId}`);
      return;
    }

    const { error: intErr } = await supabase.from('campaign_intervals').upsert(
      {
        campaign_id: campaignId,
        account_id: accountId,
        interval_time: SMOKE_INTERVAL_TIME_ISO,
        status: 'available',
      },
      { onConflict: 'campaign_id,interval_time', ignoreDuplicates: true }
    );

    if (intErr) {
      throw new Error(`campaign-smoke: campaign_intervals upsert failed: ${intErr.message}`);
    }

    ctx.log(`interval upserted interval_time=${SMOKE_INTERVAL_TIME_ISO}`);
  },
};
