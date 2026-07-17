/**
 * Deterministic integration harness for email node A/B variants:
 * seeds a real campaign, calls batch_assign_jobs_to_interval (same RPC as scheduler),
 * marks jobs sent, injects synthetic reply/bounce rows, asserts get_campaign_variant_stats.
 *
 * Send-worker SMTP is not invoked; stats read path matches production (message_jobs + threads + events).
 */

import { supabase } from '@/lib/supabase/client';
import { generateEmailVariantId } from '@/lib/email/emailNodeVariants';
import { generateTestLead } from '@/lib/devtools/campaign-flow/utils';
import {
  createCampaign,
  assignMailboxesToCampaign,
  deleteTestCampaign,
  getTestCampaigns,
  getCampaignVariantStats,
  type CampaignVariantStatRow,
} from '@/lib/supabase/services/campaigns';
import { createMailbox } from '@/lib/supabase/services/mailboxes';
import { createLead } from '@/lib/supabase/services/leads';

export const EMAIL_VARIANTS_HARNESS_PREFIX = 'email-variants-harness';

export interface EmailVariantsHarnessFixture {
  testRunId: string;
  campaignId: string;
  accountId: string;
  emailNodeDbId: string;
  flowEmailNodeId: string;
  variantIds: [string, string];
  mailboxIds: [string, string];
  leadIds: [string, string];
  enrollmentIds: [string, string];
}

export interface HarnessRunResult {
  fixture: EmailVariantsHarnessFixture;
  messageJobIds: string[];
  variantIdsAssigned: [string, string];
  stats: CampaignVariantStatRow[];
  assertions: { name: string; ok: boolean; detail?: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildFlowData(variantA: string, variantB: string) {
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
        position: { x: 200, y: 0 },
        data: {
          label: 'Harness email',
          variants: [
            {
              id: variantA,
              label: 'A',
              subject: 'Variant A subject',
              template: 'Body A {{name}}',
              isActive: true,
              order: 0,
            },
            {
              id: variantB,
              label: 'B',
              subject: 'Variant B subject',
              template: 'Body B {{name}}',
              isActive: true,
              order: 1,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  };
}

/**
 * Create a running campaign with two active variants, two @furnace.test mailboxes,
 * two leads+enrollments pinned to the email node (different mailboxes for one-interval batching).
 */
export async function seedEmailVariantsHarness(params: {
  userId: string;
  accountId: string;
}): Promise<EmailVariantsHarnessFixture> {
  const testRunId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const variantA = generateEmailVariantId();
  const variantB = generateEmailVariantId();
  const flowData = buildFlowData(variantA, variantB);

  const campaign = await createCampaign({
    name: `${EMAIL_VARIANTS_HARNESS_PREFIX} ${testRunId.slice(0, 8)}`,
    owner_id: params.userId,
    account_id: params.accountId,
    organization_id: null,
    status: 'running',
    flow_data: flowData as unknown as Record<string, unknown>,
    schedule: {
      timezone: 'UTC',
      start_hour: 0,
      start_minute: 0,
      end_hour: 23,
      end_minute: 59,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
    },
    sending_interval_seconds: 300,
  });

  await sleep(600);

  const { data: emailNode, error: nodeErr } = await supabase
    .from('nodes')
    .select('id, flow_node_id')
    .eq('campaign_id', campaign.id)
    .eq('flow_node_id', 'email-1')
    .is('deleted_at', null)
    .maybeSingle();

  if (nodeErr || !emailNode) {
    throw new Error(`Harness: email node not synced: ${nodeErr?.message ?? 'missing'}`);
  }

  const mailboxIds: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const mb = await createMailbox({
      user_id: params.userId,
      account_id: params.accountId,
      email_address: `ev-harness-${testRunId.slice(0, 8)}-${i}@furnace.test`,
      display_name: `Harness MB ${i}`,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: `ev-harness-${i}@furnace.test`,
      smtp_password: 'test-password',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: `ev-harness-${i}@furnace.test`,
      imap_password: 'test-password',
      imap_use_ssl: true,
      status: 'connected',
      provider: 'gmail' as any,
    });
    mailboxIds.push(mb.id);
  }

  await assignMailboxesToCampaign(campaign.id, mailboxIds);

  const leadIds: string[] = [];
  const enrollmentIds: string[] = [];

  for (let i = 0; i < 2; i++) {
    const leadData = generateTestLead(i + 1);
    const lead = await createLead({
      campaign_id: campaign.id,
      bucket_id: campaign.bucket_id,
      account_id: params.accountId,
      email: leadData.email,
      name: leadData.name,
      source: EMAIL_VARIANTS_HARNESS_PREFIX,
    });

    leadIds.push(lead.id);

    const { data: ins, error: enrErr } = await supabase
      .from('enrollments')
      .insert({
        campaign_id: campaign.id,
        account_id: params.accountId,
        lead_id: lead.id,
        current_node_id: emailNode.id,
        state: 'active',
        next_run_at: new Date().toISOString(),
        flow_position: {},
      })
      .select('id')
      .single();

    if (enrErr || !ins) throw new Error(`Harness: enrollment failed: ${enrErr?.message}`);
    enrollmentIds.push(ins.id as string);
  }

  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { error: intErr } = await supabase.from('campaign_intervals').upsert(
    {
      campaign_id: campaign.id,
      account_id: params.accountId,
      interval_time: future,
      status: 'available',
    },
    { onConflict: 'campaign_id,interval_time', ignoreDuplicates: true }
  );
  if (intErr) throw new Error(`Harness: failed to create interval: ${intErr.message}`);

  return {
    testRunId,
    campaignId: campaign.id,
    accountId: params.accountId,
    emailNodeDbId: emailNode.id as string,
    flowEmailNodeId: 'email-1',
    variantIds: [variantA, variantB],
    mailboxIds: [mailboxIds[0], mailboxIds[1]],
    leadIds: [leadIds[0], leadIds[1]],
    enrollmentIds: [enrollmentIds[0], enrollmentIds[1]],
  };
}

/**
 * Calls the same RPC the scheduler uses; returns created message job ids (ordered by RPC insert order).
 */
export async function assignJobsViaBatchRpc(fixture: EmailVariantsHarnessFixture): Promise<{
  jobsCreated: number;
  messageJobIds: string[];
}> {
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, email, name, first_name, last_name, mailbox_id')
    .in('id', fixture.leadIds);

  if (leadsErr || !leads?.length) {
    throw new Error(`Harness: leads load failed: ${leadsErr?.message}`);
  }

  const leadById = new Map(leads.map((l: any) => [l.id as string, l]));
  const jobData: Record<string, unknown>[] = [];

  for (let i = 0; i < fixture.enrollmentIds.length; i++) {
    const eid = fixture.enrollmentIds[i];
    const leadId = fixture.leadIds[i];
    const lead = leadById.get(leadId) as any;
    const mailboxId = lead?.mailbox_id ?? fixture.mailboxIds[i % fixture.mailboxIds.length];
    if (!mailboxId) {
      throw new Error(`Harness: unable to resolve mailbox for lead ${leadId}`);
    }
    jobData.push({
      enrollment_id: eid,
      lead_id: leadId,
      mailbox_id: mailboxId,
      node_id: fixture.emailNodeDbId,
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
    p_campaign_id: fixture.campaignId,
    p_job_data: jobData as unknown[],
    p_worker_id: 'email-variants-harness',
  });

  if (rpcErr) {
    throw new Error(`batch_assign_jobs_to_interval: ${rpcErr.message}`);
  }

  const jobsCreated = rpcResult && rpcResult[0] ? Number((rpcResult[0] as any).jobs_created ?? 0) : 0;

  const { data: jobs, error: jErr } = await supabase
    .from('message_jobs')
    .select('id, variant_id, enrollment_id, created_at')
    .eq('campaign_id', fixture.campaignId);

  if (jErr) throw new Error(`Harness: message_jobs fetch failed: ${jErr.message}`);

  const order = new Map(fixture.enrollmentIds.map((id, idx) => [id, idx]));
  const sorted = [...(jobs ?? [])].sort((a: any, b: any) => {
    const ai = order.get(a.enrollment_id as string) ?? 0;
    const bi = order.get(b.enrollment_id as string) ?? 0;
    return ai - bi;
  });

  return {
    jobsCreated,
    messageJobIds: sorted.map((j: any) => j.id as string),
  };
}

/**
 * Marks jobs sent and inserts synthetic reply (Interested) for first job, bounce for second — stats-only path.
 */
export async function injectSyntheticReplyAndBounce(fixture: EmailVariantsHarnessFixture, messageJobIds: string[]) {
  if (messageJobIds.length < 2) {
    throw new Error('Harness: need at least 2 message jobs for synthetic outcomes');
  }

  const [jobReply, jobBounce] = messageJobIds;

  const { data: jobs, error: loadErr } = await supabase
    .from('message_jobs')
    .select('id, lead_id, enrollment_id, mailbox_id, variant_id')
    .in('id', [jobReply, jobBounce]);

  if (loadErr || !jobs || jobs.length < 2) {
    throw new Error(`Harness: load message_jobs for synthetic: ${loadErr?.message}`);
  }

  const byId = new Map(jobs.map((j: any) => [j.id, j]));

  for (const jid of messageJobIds) {
    const { error: uErr } = await supabase.from('message_jobs').update({ status: 'sent' }).eq('id', jid);
    if (uErr) throw new Error(`Harness: mark sent failed: ${uErr.message}`);
  }

  const jr = byId.get(jobReply) as any;
  const jb = byId.get(jobBounce) as any;

  const { error: thErr } = await supabase.from('email_threads').insert({
    account_id: fixture.accountId,
    campaign_id: fixture.campaignId,
    lead_id: jr.lead_id,
    enrollment_id: jr.enrollment_id,
    message_job_id: jobReply,
    mailbox_id: jr.mailbox_id,
    subject: 'Re: test',
    participants: ['a@b.com', 'c@d.com'],
    last_message_at: new Date().toISOString(),
    last_inbound_at: new Date().toISOString(),
    message_count: 2,
    has_reply: true,
    category: 'Interested',
    category_source: 'system',
  });
  if (thErr) throw new Error(`Harness: email_threads insert: ${thErr.message}`);

  const { error: replyEvErr } = await supabase.from('events').insert({
    campaign_id: fixture.campaignId,
    account_id: fixture.accountId,
    lead_id: jr.lead_id,
    enrollment_id: jr.enrollment_id,
    message_job_id: jobReply,
    mailbox_id: jr.mailbox_id,
    event_type: 'replied',
    event_data: { source: EMAIL_VARIANTS_HARNESS_PREFIX, is_positive: true },
  });
  if (replyEvErr) throw new Error(`Harness: replied event insert: ${replyEvErr.message}`);

  const { error: evErr } = await supabase.from('events').insert({
    campaign_id: fixture.campaignId,
    account_id: fixture.accountId,
    lead_id: jb.lead_id,
    enrollment_id: jb.enrollment_id,
    message_job_id: jobBounce,
    mailbox_id: jb.mailbox_id,
    event_type: 'bounced',
    event_data: { source: EMAIL_VARIANTS_HARNESS_PREFIX },
  });
  if (evErr) throw new Error(`Harness: bounce event insert: ${evErr.message}`);
}

function statFor(
  stats: CampaignVariantStatRow[],
  nodeId: string,
  variantId: string
): CampaignVariantStatRow | undefined {
  return stats.find((s) => s.nodeId === nodeId && s.variantId === variantId);
}

/**
 * Full pipeline: batch assign → assert round-robin variant ids → synthetic outcomes → assert RPC stats.
 */
export async function runEmailVariantsHarnessAssertion(
  params: { userId: string; accountId: string },
  options?: { skipCleanup?: boolean }
): Promise<HarnessRunResult> {
  const fixture = await seedEmailVariantsHarness(params);
  const assertions: HarnessRunResult['assertions'] = [];

  try {
    const { jobsCreated, messageJobIds } = await assignJobsViaBatchRpc(fixture);

    assertions.push({
      name: 'batch_assign created 2 jobs',
      ok: jobsCreated === 2 && messageJobIds.length === 2,
      detail: `jobs_created=${jobsCreated}, rows=${messageJobIds.length}`,
    });

    const { data: variantRows } = await supabase
      .from('message_jobs')
      .select('variant_id, enrollment_id')
      .in('id', messageJobIds);

    const ord = new Map(fixture.enrollmentIds.map((id, idx) => [id, idx]));
    const assigned = [...(variantRows ?? [])]
      .sort((a: any, b: any) => (ord.get(a.enrollment_id) ?? 0) - (ord.get(b.enrollment_id) ?? 0))
      .map((r: any) => r.variant_id as string);
    const variantIdsAssigned: [string, string] = [assigned[0], assigned[1]];

    assertions.push({
      name: 'round-robin variant order A then B',
      ok: assigned[0] === fixture.variantIds[0] && assigned[1] === fixture.variantIds[1],
      detail: JSON.stringify(assigned),
    });

    await injectSyntheticReplyAndBounce(fixture, messageJobIds);

    const stats = await getCampaignVariantStats(fixture.campaignId);

    const s0 = statFor(stats, fixture.emailNodeDbId, fixture.variantIds[0]);
    const s1 = statFor(stats, fixture.emailNodeDbId, fixture.variantIds[1]);

    assertions.push({
      name: 'variant A sent/replied/positive',
      ok: !!(s0 && s0.sent === 1 && s0.replied === 1 && s0.positiveReply === 1 && s0.bounced === 0),
      detail: s0 ? JSON.stringify(s0) : 'missing row',
    });
    assertions.push({
      name: 'variant B sent/bounced',
      ok: !!(s1 && s1.sent === 1 && s1.replied === 0 && s1.positiveReply === 0 && s1.bounced === 1),
      detail: s1 ? JSON.stringify(s1) : 'missing row',
    });

    return {
      fixture,
      messageJobIds,
      variantIdsAssigned,
      stats,
      assertions,
    };
  } finally {
    if (!options?.skipCleanup) {
      try {
        await cleanupEmailVariantsHarness(fixture.campaignId);
      } catch (e) {
        console.error('Harness cleanup failed:', e);
      }
    }
  }
}

/** Uses shared test campaign deletion (removes @furnace.test mailboxes when unused). */
export async function cleanupEmailVariantsHarness(campaignId: string): Promise<void> {
  await deleteTestCampaign(campaignId);
}

/**
 * Deletes abandoned harness campaigns (same naming prefix + test markers) older than maxAgeMs.
 * Safe to call periodically from the internal test page.
 */
export async function sweepAbandonedEmailVariantsHarnessCampaigns(
  userId: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<{ deletedIds: string[] }> {
  const campaigns = await getTestCampaigns(userId);
  const now = Date.now();
  const deletedIds: string[] = [];
  for (const c of campaigns) {
    if (!c.name?.startsWith(EMAIL_VARIANTS_HARNESS_PREFIX)) continue;
    const age = now - new Date(c.created_at).getTime();
    if (age <= maxAgeMs) continue;
    try {
      await deleteTestCampaign(c.id);
      deletedIds.push(c.id);
    } catch (e) {
      console.warn('Harness sweep: failed to delete', c.id, e);
    }
  }
  return { deletedIds };
}
