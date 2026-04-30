import type { SeedModule } from '../../types';
import { SMOKE_VARIANT_IDS, campaignIdShort } from '../../constants/campaignSmoke';
import { smokeCampaignName } from '../../theme/falloutCopy';
import { campaignSmokeStore } from './store';
import { buildSmokeFlowData, smokeSchedule } from './buildFlow';

export const campaignSmokeCampaignModule: SeedModule = {
  id: 'campaignSmoke_campaign',
  description: 'Upsert running campaign with Fallout-themed flow_data',
  deps: ['campaignSmoke_env'],
  async run(ctx) {
    const { supabase } = ctx;
    const { campaignId, ownerUserId, accountId } = campaignSmokeStore;
    const slice = campaignIdShort(campaignId);
    const name = smokeCampaignName(slice);
    const flowData = buildSmokeFlowData(SMOKE_VARIANT_IDS[0], SMOKE_VARIANT_IDS[1]);
    const schedule = smokeSchedule();
    const now = new Date().toISOString();

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would upsert campaign id=${campaignId} name=${name}`);
      return;
    }

    const { data: existing, error: selErr } = await supabase
      .from('campaigns')
      .select('id, bucket_id, deleted_at')
      .eq('id', campaignId)
      .maybeSingle();

    if (selErr) {
      throw new Error(`campaign-smoke: failed to read campaign: ${selErr.message}`);
    }

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('campaigns')
        .update({
          name,
          owner_id: ownerUserId,
          account_id: accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: 300,
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', campaignId);

      if (upErr) {
        throw new Error(`campaign-smoke: failed to update campaign: ${upErr.message}`);
      }
      campaignSmokeStore.bucketId = (existing.bucket_id as string) || '';
      if (!campaignSmokeStore.bucketId) {
        const { data: row, error: bErr } = await supabase
          .from('campaigns')
          .select('bucket_id')
          .eq('id', campaignId)
          .single();
        if (bErr || !row?.bucket_id) {
          throw new Error(`campaign-smoke: missing bucket_id after update: ${bErr?.message}`);
        }
        campaignSmokeStore.bucketId = row.bucket_id as string;
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('campaigns')
        .insert({
          id: campaignId,
          name,
          owner_id: ownerUserId,
          account_id: accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: 300,
          created_at: now,
          updated_at: now,
        })
        .select('bucket_id')
        .single();

      if (insErr || !inserted) {
        throw new Error(`campaign-smoke: failed to insert campaign: ${insErr?.message}`);
      }
      campaignSmokeStore.bucketId = inserted.bucket_id as string;
    }

    ctx.log(`campaign upserted id=${campaignId} bucket_id=${campaignSmokeStore.bucketId}`);
  },
};
