import type { SeedModule } from '../../types';
import { SEED_LEAD_SOURCE } from '../../constants/campaignSmoke';
import { smokeLeadPersonaWithSlice } from '../../theme/falloutCopy';
import { campaignSmokeStore } from './store';

export const campaignSmokeLeadsModule: SeedModule = {
  id: 'campaignSmoke_leadsEnrollments',
  description: 'Replace seed leads/enrollments for this campaign',
  deps: ['campaignSmoke_waitNodes'],
  async run(ctx) {
    const { supabase } = ctx;
    const { campaignId, accountId, bucketId, emailNodeDbId } = campaignSmokeStore;

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would reset leads+enrollments for campaign=${campaignId}`);
      return;
    }

    const { data: enrollRows, error: enSelErr } = await supabase
      .from('enrollments')
      .select('id')
      .eq('campaign_id', campaignId);

    if (enSelErr) {
      throw new Error(`campaign-smoke: enrollments select failed: ${enSelErr.message}`);
    }

    const enrollmentIds = (enrollRows ?? []).map((r) => r.id as string);
    if (enrollmentIds.length > 0) {
      const { error: delJobsErr } = await supabase
        .from('message_jobs')
        .delete()
        .in('enrollment_id', enrollmentIds);
      if (delJobsErr) {
        throw new Error(`campaign-smoke: message_jobs delete failed: ${delJobsErr.message}`);
      }
    }

    const { error: delEnrErr } = await supabase
      .from('enrollments')
      .delete()
      .eq('campaign_id', campaignId);
    if (delEnrErr) {
      throw new Error(`campaign-smoke: enrollments delete failed: ${delEnrErr.message}`);
    }

    const { error: delLeadErr } = await supabase.from('leads').delete().eq('campaign_id', campaignId);
    if (delLeadErr) {
      throw new Error(`campaign-smoke: leads delete failed: ${delLeadErr.message}`);
    }

    const leadIds: string[] = [];
    const enrollmentIdsOut: string[] = [];
    const nextRunAt = new Date().toISOString();

    for (let i = 0; i < 2; i++) {
      const persona = smokeLeadPersonaWithSlice(campaignId, i as 0 | 1);
      const email = `${persona.emailLocal}@furnace.test`;

      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          campaign_id: campaignId,
          bucket_id: bucketId,
          account_id: accountId,
          email,
          name: persona.name,
          first_name: persona.first_name,
          last_name: persona.last_name,
          company_name: persona.company_name,
          source: SEED_LEAD_SOURCE,
        })
        .select('id')
        .single();

      if (leadErr || !lead) {
        throw new Error(`campaign-smoke: lead insert failed: ${leadErr?.message}`);
      }

      const leadId = lead.id as string;
      leadIds.push(leadId);

      const { data: enr, error: enrErr } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: campaignId,
          account_id: accountId,
          lead_id: leadId,
          current_node_id: emailNodeDbId,
          state: 'active',
          next_run_at: nextRunAt,
          flow_position: {},
        })
        .select('id')
        .single();

      if (enrErr || !enr) {
        throw new Error(`campaign-smoke: enrollment insert failed: ${enrErr?.message}`);
      }
      enrollmentIdsOut.push(enr.id as string);
    }

    campaignSmokeStore.leadIds = leadIds;
    campaignSmokeStore.enrollmentIds = enrollmentIdsOut;
    ctx.log(`leads+enrollments created leads=${leadIds.join(',')} enrollments=${enrollmentIdsOut.join(',')}`);
  },
};
