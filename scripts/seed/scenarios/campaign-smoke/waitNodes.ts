import type { SeedModule } from '../../types';
import { campaignSmokeStore } from './store';

const POLL_MS = 250;
const TIMEOUT_MS = 30_000;

export const campaignSmokeWaitNodesModule: SeedModule = {
  id: 'campaignSmoke_waitNodes',
  description: 'Poll until nodes sync for email-1',
  deps: ['campaignSmoke_mailboxes'],
  async run(ctx) {
    const { supabase } = ctx;
    const { campaignId } = campaignSmokeStore;

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would poll nodes for campaign=${campaignId} flow_node_id=email-1`);
      return;
    }

    const deadline = Date.now() + TIMEOUT_MS;
    let emailNodeId: string | null = null;

    while (Date.now() < deadline) {
      const { data, error } = await supabase
        .from('nodes')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('flow_node_id', 'email-1')
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new Error(`campaign-smoke: nodes poll failed: ${error.message}`);
      }
      if (data?.id) {
        emailNodeId = data.id as string;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (!emailNodeId) {
      throw new Error(
        'campaign-smoke: timed out waiting for email node (sync_campaign_nodes trigger). Check flow_data.'
      );
    }

    campaignSmokeStore.emailNodeDbId = emailNodeId;
    ctx.log(`nodes ready emailNodeDbId=${emailNodeId}`);
  },
};
