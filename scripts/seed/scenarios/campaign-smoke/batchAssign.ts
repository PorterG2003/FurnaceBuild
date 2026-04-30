import type { SeedModule } from '../../types';
import { SEED_WORKER_ID } from '../../constants/campaignSmoke';
import { campaignSmokeStore } from './store';

export const campaignSmokeBatchAssignModule: SeedModule = {
  id: 'campaignSmoke_batchAssign',
  description: 'batch_assign_jobs_to_interval (scheduler parity)',
  deps: ['campaignSmoke_interval'],
  async run(ctx) {
    const { supabase } = ctx;
    const {
      campaignId,
      emailNodeDbId,
      leadIds,
      enrollmentIds,
      mailboxIds,
    } = campaignSmokeStore;

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would call batch_assign_jobs_to_interval campaign=${campaignId}`);
      return;
    }

    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, email, name, first_name, last_name, mailbox_id')
      .in('id', leadIds);

    if (leadsErr || !leads?.length) {
      throw new Error(`campaign-smoke: leads load failed: ${leadsErr?.message}`);
    }

    const leadById = new Map(leads.map((l) => [l.id as string, l]));
    const jobData: Record<string, unknown>[] = [];

    for (let i = 0; i < enrollmentIds.length; i++) {
      const eid = enrollmentIds[i];
      const leadId = leadIds[i];
      const lead = leadById.get(leadId!);
      if (!lead?.mailbox_id) {
        throw new Error(`campaign-smoke: lead ${leadId} missing mailbox_id`);
      }
      jobData.push({
        enrollment_id: eid,
        lead_id: leadId,
        mailbox_id: lead.mailbox_id,
        node_id: emailNodeDbId,
        message_data: {
          node_config: {},
          lead_data: {
            email: lead.email,
            name: lead.name,
            first_name: lead.first_name,
            last_name: lead.last_name,
          },
        },
        jitter_percentage: 10,
      });
    }

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('batch_assign_jobs_to_interval', {
      p_campaign_id: campaignId,
      p_job_data: jobData as unknown[],
      p_worker_id: SEED_WORKER_ID,
      p_required_mailbox_count: mailboxIds.length,
    });

    if (rpcErr) {
      throw new Error(`campaign-smoke: batch_assign_jobs_to_interval failed: ${rpcErr.message}`);
    }

    const jobsCreated =
      rpcResult && (rpcResult as unknown[])[0]
        ? Number(((rpcResult as unknown[])[0] as Record<string, unknown>).jobs_created ?? 0)
        : 0;

    const { data: jobs, error: jErr } = await supabase
      .from('message_jobs')
      .select('id, enrollment_id, status')
      .eq('campaign_id', campaignId);

    if (jErr) {
      throw new Error(`campaign-smoke: message_jobs fetch failed: ${jErr.message}`);
    }

    ctx.log(`batch_assign jobs_created=${jobsCreated} message_jobs=${(jobs ?? []).length}`);
  },
};
