import type { Json } from '../../../../lib/supabase/types/database';
import type { SeedContext, SeedModule } from '../../types';
import {
  buildOooRuntimeIntervalIsoTimes,
  buildOooThreadSpecs,
  DEFAULT_SEED_OOO_CAMPAIGN_ID,
  headerMessageId,
  OOO_HISTORICAL_INTERVAL_ANCHOR_ISO,
  OOO_INBOX_CASE_KEYS,
  OOO_RUNTIME_INTERVAL_COUNT,
  OOO_SEED_SENDING_INTERVAL_SECONDS,
  OOO_SEED_SOURCE,
  OOO_SEED_WORKER_ID,
  oooThreadId,
  type OooInboxCaseKey,
  type OooThreadSpec,
} from '../../constants/oooMixedInbox';
import {
  oooCampaignName,
  OOO_CASE_COPY,
  oooLeadPersona,
  oooMailboxEmailLocalPart,
  oooReceivedBodyForIndex,
} from '../../theme/falloutOooCopy';
import { SMOKE_VARIANT_IDS } from '../../constants/campaignSmoke';
import { smokeSchedule } from '../campaign-smoke/buildFlow';

const OOO_SECOND_EMAIL_VARIANT_IDS = [
  'f0000000-0000-4000-8000-00000000d221',
  'f0000000-0000-4000-8000-00000000d222',
] as const;

const OOO_WAIT_FLOW_NODE_ID = 'waitTime-1';

function buildOooFlowData(): Json {
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Wasteland Lead Tap' },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'OOO Probe',
          variants: [
            {
              id: SMOKE_VARIANT_IDS[0],
              label: 'Capital Wasteland Ping',
              subject: 'Checking in before your caravan rotation, {{name}}',
              template:
                'Howdy {{name}} - quick dev-only check-in from the wasteland desk before your next caravan rotation.',
              isActive: true,
              order: 0,
            },
            {
              id: SMOKE_VARIANT_IDS[1],
              label: 'Mojave Scout Ping',
              subject: 'Quick route check before your outpost shift, {{name}}',
              template:
                'Hi {{name}} - fake seed follow-up from the Mojave relay team before your next outpost shift.',
              isActive: true,
              order: 1,
            },
          ],
        },
      },
      {
        id: OOO_WAIT_FLOW_NODE_ID,
        type: 'waitTime',
        position: { x: 460, y: 0 },
        data: {
          label: 'Hold For Return',
          wait_duration_seconds: 0,
        },
      },
      {
        id: 'email-2',
        type: 'email',
        position: { x: 700, y: 0 },
        data: {
          label: 'Return Follow-Up',
          variants: [
            {
              id: OOO_SECOND_EMAIL_VARIANT_IDS[0],
              label: 'After Return - Route Recheck',
              subject: 'Welcome back - should we restart the supply route, {{name}}?',
              template:
                'Welcome back {{name}} - reopening the wasteland route now that your OOO window has passed. Want the next step?',
              isActive: true,
              order: 0,
            },
            {
              id: OOO_SECOND_EMAIL_VARIANT_IDS[1],
              label: 'After Return - Final Nudge',
              subject: 'Back from the outpost? We can restart the route, {{name}}',
              template:
                'Hey {{name}} - now that you are back from the outpost, I can resend the route details whenever you are ready.',
              isActive: true,
              order: 1,
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'leadSource-1', target: 'email-1' },
      { id: 'e2', source: 'email-1', target: OOO_WAIT_FLOW_NODE_ID },
      { id: 'e3', source: OOO_WAIT_FLOW_NODE_ID, target: 'email-2' },
    ],
  } as unknown as Json;
}

type OooMailboxState = {
  id: string;
  email: string;
};

type OooThreadState = OooThreadSpec & {
  mailboxId: string;
  mailboxEmail: string;
  leadId: string;
  leadEmail: string;
  leadName: string;
  leadFirstName: string;
  leadLastName: string;
  enrollmentId: string;
  messageJobId: string;
  threadId: string;
  sentAt: string;
  replyAt: string;
  lastMessageAt: string;
  messageCount: number;
  unread: boolean;
};

const oooStore: {
  accountId: string;
  ownerUserId: string;
  campaignId: string;
  bucketId: string;
  emailNodeDbId: string;
  waitNodeDbId: string;
  mailboxes: Record<OooInboxCaseKey, OooMailboxState>;
  threads: OooThreadState[];
} = {
  accountId: '',
  ownerUserId: '',
  campaignId: '',
  bucketId: '',
  emailNodeDbId: '',
  waitNodeDbId: '',
  mailboxes: {} as Record<OooInboxCaseKey, OooMailboxState>,
  threads: [],
};

function resetOooStore() {
  oooStore.accountId = '';
  oooStore.ownerUserId = '';
  oooStore.campaignId = '';
  oooStore.bucketId = '';
  oooStore.emailNodeDbId = '';
  oooStore.waitNodeDbId = '';
  oooStore.mailboxes = {} as Record<OooInboxCaseKey, OooMailboxState>;
  oooStore.threads = [];
}

function caseCopy(key: OooInboxCaseKey) {
  const copy = OOO_CASE_COPY.find((entry) => entry.key === key);
  if (!copy) {
    throw new Error(`ooo-mixed-inbox: missing copy for case ${key}`);
  }
  return copy;
}

function buildInitialThreadStates(): OooThreadState[] {
  return buildOooThreadSpecs().map((spec) => ({
    ...spec,
    mailboxId: '',
    mailboxEmail: '',
    leadId: '',
    leadEmail: '',
    leadName: '',
    leadFirstName: '',
    leadLastName: '',
    enrollmentId: '',
    messageJobId: '',
    threadId: oooThreadId(spec.key, spec.index),
    sentAt: '',
    replyAt: '',
    lastMessageAt: '',
    messageCount: 2,
    unread: spec.index % 3 !== 0,
  }));
}

function isNormalThread(thread: OooThreadState) {
  return thread.key === 'normal';
}

function buildIntervalBatches(threads: OooThreadState[]): OooThreadState[][] {
  const byIndex = new Map<number, OooThreadState[]>();
  for (const thread of threads) {
    const existing = byIndex.get(thread.index) ?? [];
    existing.push(thread);
    byIndex.set(thread.index, existing);
  }

  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, batch]) => batch);
}

function buildHistoricalIntervalTimeIso(batchIndex: number): string {
  const base = Date.parse(OOO_HISTORICAL_INTERVAL_ANCHOR_ISO);
  return new Date(base + batchIndex * 5 * 60 * 1000).toISOString();
}

/**
 * After historical email-1 completes, drop completed far-future intervals (which would
 * anchor interval maintenance years ahead) and insert near-now slots for the real scheduler.
 */
async function detachMessageJobsFromIntervalsThenDeleteIntervals(ctx: SeedContext) {
  const { supabase } = ctx;
  const clearedAt = new Date().toISOString();
  const { error: mjErr } = await supabase
    .from('message_jobs')
    .update({ interval_id: null, updated_at: clearedAt })
    .eq('campaign_id', oooStore.campaignId)
    .not('interval_id', 'is', null);
  if (mjErr) {
    throw new Error(`ooo-mixed-inbox: message_jobs interval_id clear failed: ${mjErr.message}`);
  }

  const { error: delIntErr } = await supabase
    .from('campaign_intervals')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delIntErr) {
    throw new Error(`ooo-mixed-inbox: campaign_intervals delete (pre-runtime) failed: ${delIntErr.message}`);
  }

  const { error: campErr } = await supabase
    .from('campaigns')
    .update({
      last_completed_interval_time: null,
      updated_at: clearedAt,
    })
    .eq('id', oooStore.campaignId);
  if (campErr) {
    throw new Error(`ooo-mixed-inbox: campaigns last_completed_interval_time reset failed: ${campErr.message}`);
  }
}

async function insertRuntimeReadyCampaignIntervals(ctx: SeedContext) {
  const { supabase } = ctx;
  const intervalTimes = buildOooRuntimeIntervalIsoTimes(Date.now());
  const rows = intervalTimes.map((interval_time) => ({
    campaign_id: oooStore.campaignId,
    account_id: oooStore.accountId,
    interval_time,
    status: 'available' as const,
    required_mailbox_count: 0,
  }));

  const { error: insErr } = await supabase.from('campaign_intervals').insert(rows);
  if (insErr) {
    throw new Error(`ooo-mixed-inbox: runtime campaign_intervals insert failed: ${insErr.message}`);
  }
}

function isPositiveReplyThread(thread: OooThreadState) {
  return isNormalThread(thread) && thread.index <= 3;
}

async function updateEventCreatedAt(
  ctx: SeedContext,
  thread: OooThreadState,
  eventType: 'sent' | 'replied',
  createdAt: string
) {
  const { error } = await ctx.supabase
    .from('events')
    .update({ created_at: createdAt })
    .eq('campaign_id', oooStore.campaignId)
    .eq('message_job_id', thread.messageJobId)
    .eq('event_type', eventType);
  if (error) {
    throw new Error(`ooo-mixed-inbox: ${eventType} event timestamp update failed: ${error.message}`);
  }
}

async function seedThreadEventsAndStats(ctx: SeedContext, thread: OooThreadState) {
  const sentEventData = {
    provider_message_id: headerMessageId(thread.key, thread.index, 'sent'),
    sent_at: thread.sentAt,
    source: OOO_SEED_SOURCE,
  };
  const { error: sentErr } = await ctx.supabase.rpc('record_sent_event_and_increment', {
    p_campaign_id: oooStore.campaignId,
    p_lead_id: thread.leadId,
    p_enrollment_id: thread.enrollmentId,
    p_message_job_id: thread.messageJobId,
    p_event_data: sentEventData,
  });
  if (sentErr) {
    throw new Error(`ooo-mixed-inbox: record_sent_event_and_increment failed: ${sentErr.message}`);
  }
  await updateEventCreatedAt(ctx, thread, 'sent', thread.sentAt);

  const isPositive = isPositiveReplyThread(thread);
  if (isPositive) {
    const { error: categoryErr } = await ctx.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'system',
        updated_at: thread.lastMessageAt,
      })
      .eq('id', thread.threadId);
    if (categoryErr) {
      throw new Error(`ooo-mixed-inbox: positive category update failed: ${categoryErr.message}`);
    }
  }

  const replyEventData = {
    detected_at: thread.replyAt,
    source: OOO_SEED_SOURCE,
  };
  const { error: repliedErr } = await ctx.supabase.rpc('record_replied_event_and_increment', {
    p_campaign_id: oooStore.campaignId,
    p_lead_id: thread.leadId,
    p_enrollment_id: thread.enrollmentId,
    p_message_job_id: thread.messageJobId,
    p_event_data: replyEventData,
    p_is_positive: isPositive,
  });
  if (repliedErr) {
    throw new Error(`ooo-mixed-inbox: record_replied_event_and_increment failed: ${repliedErr.message}`);
  }
  await updateEventCreatedAt(ctx, thread, 'replied', thread.replyAt);
}

async function ensureMailbox(
  ctx: SeedContext,
  key: OooInboxCaseKey
): Promise<{ id: string; email: string }> {
  const { supabase } = ctx;
  const copy = caseCopy(key);
  const emailLocal = oooMailboxEmailLocalPart(oooStore.campaignId, copy.mailboxLocalBase);
  const email = `${emailLocal}@furnace.test`;
  const now = new Date().toISOString();

  const { data: found, error: findErr } = await supabase
    .from('mailboxes')
    .select('id')
    .eq('email_address', email)
    .maybeSingle();
  if (findErr) {
    throw new Error(`ooo-mixed-inbox: mailbox lookup failed: ${findErr.message}`);
  }

  if (found?.id) {
    const { error: upErr } = await supabase
      .from('mailboxes')
      .update({
        account_id: oooStore.accountId,
        user_id: oooStore.ownerUserId,
        display_name: copy.mailboxDisplayName,
        status: 'connected',
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', found.id);
    if (upErr) {
      throw new Error(`ooo-mixed-inbox: mailbox update failed: ${upErr.message}`);
    }
    return { id: found.id as string, email };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('mailboxes')
    .insert({
      account_id: oooStore.accountId,
      user_id: oooStore.ownerUserId,
      email_address: email,
      display_name: copy.mailboxDisplayName,
      provider: 'gmail',
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: email,
      smtp_password: 'test-password',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: email,
      imap_password: 'test-password',
      imap_use_ssl: true,
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    throw new Error(`ooo-mixed-inbox: mailbox insert failed: ${insErr?.message}`);
  }
  return { id: inserted.id as string, email };
}

async function pollNodeId(ctx: SeedContext, flowNodeId: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { data, error } = await ctx.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', oooStore.campaignId)
      .eq('flow_node_id', flowNodeId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      throw new Error(`ooo-mixed-inbox: node poll failed for ${flowNodeId}: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`ooo-mixed-inbox: timed out waiting for node sync (${flowNodeId})`);
}

async function cleanupCampaignSlice(ctx: SeedContext) {
  const { supabase } = ctx;

  const { error: delEventsErr } = await supabase
    .from('events')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delEventsErr) {
    throw new Error(`ooo-mixed-inbox: events cleanup failed: ${delEventsErr.message}`);
  }

  const { error: delStatsErr } = await supabase
    .from('campaign_stats')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delStatsErr) {
    throw new Error(`ooo-mixed-inbox: campaign_stats cleanup failed: ${delStatsErr.message}`);
  }

  const { data: threads, error: threadErr } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', oooStore.campaignId);
  if (threadErr) {
    throw new Error(`ooo-mixed-inbox: thread cleanup lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threads ?? []).map((row) => row.id as string);
  if (threadIds.length > 0) {
    const { error: msgErr } = await supabase.from('email_messages').delete().in('thread_id', threadIds);
    if (msgErr) {
      throw new Error(`ooo-mixed-inbox: email_messages cleanup failed: ${msgErr.message}`);
    }
  }

  const { error: delThreadErr } = await supabase
    .from('email_threads')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delThreadErr) {
    throw new Error(`ooo-mixed-inbox: email_threads cleanup failed: ${delThreadErr.message}`);
  }

  const { error: delJobsErr } = await supabase
    .from('message_jobs')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delJobsErr) {
    throw new Error(`ooo-mixed-inbox: message_jobs cleanup failed: ${delJobsErr.message}`);
  }

  const { error: delEnrErr } = await supabase
    .from('enrollments')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delEnrErr) {
    throw new Error(`ooo-mixed-inbox: enrollments cleanup failed: ${delEnrErr.message}`);
  }

  const { error: delLeadErr } = await supabase
    .from('leads')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delLeadErr) {
    throw new Error(`ooo-mixed-inbox: leads cleanup failed: ${delLeadErr.message}`);
  }

  const { error: delLinkErr } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delLinkErr) {
    throw new Error(`ooo-mixed-inbox: campaign_mailboxes cleanup failed: ${delLinkErr.message}`);
  }

  const { error: delIntervalErr } = await supabase
    .from('campaign_intervals')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delIntervalErr) {
    throw new Error(`ooo-mixed-inbox: campaign_intervals cleanup failed: ${delIntervalErr.message}`);
  }
}

async function markThreadOutOfOffice(
  ctx: SeedContext,
  threadId: string,
  outOfOffice: boolean,
  resumeRequested: boolean,
  resumeAt: string | null
) {
  const { error } = await ctx.supabase.rpc('mark_email_thread_out_of_office', {
    p_thread_id: threadId,
    p_out_of_office: outOfOffice,
    p_resume_requested: resumeRequested,
    p_resume_at: resumeAt,
  });
  if (error) {
    throw new Error(`ooo-mixed-inbox: mark_email_thread_out_of_office failed: ${error.message}`);
  }
}

export const oooInboxEnvModule: SeedModule = {
  id: 'oooInbox_env',
  description: 'Validate env and initialize ooo-mixed-inbox store',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'ooo-mixed-inbox requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).'
      );
    }
    resetOooStore();
    oooStore.accountId = accountId;
    oooStore.ownerUserId = ownerUserId;
    oooStore.campaignId =
      process.env.SEED_OOO_CAMPAIGN_ID?.trim() ||
      process.env.SEED_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_OOO_CAMPAIGN_ID;
    oooStore.threads = buildInitialThreadStates();

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would use accountId=${accountId} ownerUserId=${ownerUserId} oooCampaignId=${oooStore.campaignId} threads=${oooStore.threads.length}`
      );
    }
  },
};

export const oooInboxBaseGraphModule: SeedModule = {
  id: 'oooInbox_baseGraph',
  description: 'Create bulk campaign/mailboxes/leads/enrollments/jobs for inbox OOO tests',
  deps: ['oooInbox_env'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would build base graph for campaign=${oooStore.campaignId} threads=${oooStore.threads.length}`
      );
      return;
    }

    const now = new Date().toISOString();
    const { supabase } = ctx;
    const flowData = buildOooFlowData();
    const schedule = smokeSchedule();

    const { data: existing, error: selErr } = await supabase
      .from('campaigns')
      .select('id, bucket_id')
      .eq('id', oooStore.campaignId)
      .maybeSingle();
    if (selErr) {
      throw new Error(`ooo-mixed-inbox: campaign lookup failed: ${selErr.message}`);
    }

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('campaigns')
        .update({
          name: oooCampaignName(oooStore.campaignId),
          owner_id: oooStore.ownerUserId,
          account_id: oooStore.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: OOO_SEED_SENDING_INTERVAL_SECONDS,
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', oooStore.campaignId);
      if (upErr) {
        throw new Error(`ooo-mixed-inbox: campaign update failed: ${upErr.message}`);
      }
      oooStore.bucketId = (existing.bucket_id as string) || '';
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('campaigns')
        .insert({
          id: oooStore.campaignId,
          name: oooCampaignName(oooStore.campaignId),
          owner_id: oooStore.ownerUserId,
          account_id: oooStore.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: OOO_SEED_SENDING_INTERVAL_SECONDS,
          created_at: now,
          updated_at: now,
        })
        .select('bucket_id')
        .single();
      if (insErr || !inserted) {
        throw new Error(`ooo-mixed-inbox: campaign insert failed: ${insErr?.message}`);
      }
      oooStore.bucketId = inserted.bucket_id as string;
    }

    if (!oooStore.bucketId) {
      const { data: row, error: bucketErr } = await supabase
        .from('campaigns')
        .select('bucket_id')
        .eq('id', oooStore.campaignId)
        .single();
      if (bucketErr || !row?.bucket_id) {
        throw new Error(`ooo-mixed-inbox: missing bucket_id: ${bucketErr?.message}`);
      }
      oooStore.bucketId = row.bucket_id as string;
    }

    await cleanupCampaignSlice(ctx);

    const mailboxRows: { campaign_id: string; mailbox_id: string; account_id: string }[] = [];
    for (const key of OOO_INBOX_CASE_KEYS) {
      const mailbox = await ensureMailbox(ctx, key);
      oooStore.mailboxes[key] = { id: mailbox.id, email: mailbox.email };
      mailboxRows.push({
        campaign_id: oooStore.campaignId,
        mailbox_id: mailbox.id,
        account_id: oooStore.accountId,
      });
    }

    const { error: linkErr } = await supabase.from('campaign_mailboxes').insert(mailboxRows);
    if (linkErr) {
      throw new Error(`ooo-mixed-inbox: campaign_mailboxes insert failed: ${linkErr.message}`);
    }

    oooStore.emailNodeDbId = await pollNodeId(ctx, 'email-1');
    oooStore.waitNodeDbId = await pollNodeId(ctx, OOO_WAIT_FLOW_NODE_ID);

    for (const thread of oooStore.threads) {
      const persona = oooLeadPersona(oooStore.campaignId, thread.key, thread.index);
      const mailbox = oooStore.mailboxes[thread.key];

      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          campaign_id: oooStore.campaignId,
          bucket_id: oooStore.bucketId,
          account_id: oooStore.accountId,
          email: persona.email,
          name: persona.name,
          first_name: persona.firstName,
          last_name: persona.lastName,
          company_name: persona.companyName,
          source: OOO_SEED_SOURCE,
          mailbox_id: mailbox.id,
        })
        .select('id')
        .single();
      if (leadErr || !lead) {
        throw new Error(`ooo-mixed-inbox: lead insert failed: ${leadErr?.message}`);
      }

      const { data: enrollment, error: enrErr } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: oooStore.campaignId,
          account_id: oooStore.accountId,
          lead_id: lead.id,
          current_node_id: oooStore.emailNodeDbId,
          state: 'active',
          next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          flow_position: {},
        })
        .select('id')
        .single();
      if (enrErr || !enrollment) {
        throw new Error(`ooo-mixed-inbox: enrollment insert failed: ${enrErr?.message}`);
      }

      thread.mailboxId = mailbox.id;
      thread.mailboxEmail = mailbox.email;
      thread.leadId = lead.id as string;
      thread.leadEmail = persona.email;
      thread.leadName = persona.name;
      thread.leadFirstName = persona.firstName;
      thread.leadLastName = persona.lastName;
      thread.enrollmentId = enrollment.id as string;
    }

    const intervalBatches = buildIntervalBatches(oooStore.threads);
    const intervalRows = intervalBatches.map((batch, batchIndex) => ({
      campaign_id: oooStore.campaignId,
      account_id: oooStore.accountId,
      interval_time: buildHistoricalIntervalTimeIso(batchIndex),
      status: 'available',
      required_mailbox_count: batch.length,
    }));

    const { error: intErr } = await supabase.from('campaign_intervals').upsert(intervalRows, {
      onConflict: 'campaign_id,interval_time',
      ignoreDuplicates: true,
    });
    if (intErr) {
      throw new Error(`ooo-mixed-inbox: campaign_intervals upsert failed: ${intErr.message}`);
    }

    let jobsCreatedTotal = 0;
    const baseTime = Date.now() - 24 * 60 * 60 * 1000;
    let globalOrder = 0;
    for (const batch of intervalBatches) {
      const batchJobData = batch.map((thread) => ({
        enrollment_id: thread.enrollmentId,
        lead_id: thread.leadId,
        mailbox_id: thread.mailboxId,
        node_id: oooStore.emailNodeDbId,
        message_data: {
          node_config: {},
          lead_data: {
            email: thread.leadEmail,
            name: thread.leadName,
            first_name: thread.leadFirstName,
            last_name: thread.leadLastName,
          },
        },
        jitter_percentage: 10,
      }));

      const { data: rpcResult, error: rpcErr } = await supabase.rpc('batch_assign_jobs_to_interval', {
        p_campaign_id: oooStore.campaignId,
        p_job_data: batchJobData as unknown[],
        p_worker_id: OOO_SEED_WORKER_ID,
        p_required_mailbox_count: batch.length,
      });
      if (rpcErr) {
        throw new Error(`ooo-mixed-inbox: batch_assign_jobs_to_interval failed: ${rpcErr.message}`);
      }

      const rpcRow =
        rpcResult && (rpcResult as unknown[])[0]
          ? ((rpcResult as unknown[])[0] as Record<string, unknown>)
          : null;
      const intervalId = (rpcRow?.interval_id as string | undefined) ?? null;
      jobsCreatedTotal += Number(rpcRow?.jobs_created ?? 0);

      if (!intervalId) {
        throw new Error('ooo-mixed-inbox: batch_assign_jobs_to_interval did not return interval_id');
      }

      const { data: jobs, error: jobsErr } = await supabase
        .from('message_jobs')
        .select('id, enrollment_id')
        .eq('campaign_id', oooStore.campaignId)
        .eq('interval_id', intervalId)
        .in(
          'enrollment_id',
          batch.map((thread) => thread.enrollmentId)
        );
      if (jobsErr) {
        throw new Error(`ooo-mixed-inbox: message_jobs fetch failed: ${jobsErr.message}`);
      }

      const jobsByEnrollment = new Map(
        (jobs ?? []).map((row) => [row.enrollment_id as string, row.id as string])
      );

      for (const thread of batch) {
        const jobId = jobsByEnrollment.get(thread.enrollmentId);
        if (!jobId) {
          throw new Error(`ooo-mixed-inbox: missing message_job for ${thread.key}#${thread.index}`);
        }

        const sentAt = new Date(baseTime + globalOrder * 20 * 60 * 1000).toISOString();
        const replyAt = new Date(Date.parse(sentAt) + 15 * 60 * 1000).toISOString();
        const { error: upJobErr } = await supabase
          .from('message_jobs')
          .update({
            status: 'sent',
            sent_at: sentAt,
            scheduled_at: sentAt,
            provider_message_id: headerMessageId(thread.key, thread.index, 'sent'),
            updated_at: now,
          })
          .eq('id', jobId);
        if (upJobErr) {
          throw new Error(`ooo-mixed-inbox: message_job update failed: ${upJobErr.message}`);
        }

        thread.messageJobId = jobId;
        thread.sentAt = sentAt;
        thread.replyAt = replyAt;
        thread.lastMessageAt = isNormalThread(thread)
          ? new Date(Date.parse(replyAt) + ((thread.index % 3) + 1) * 18 * 60 * 1000).toISOString()
          : replyAt;
        thread.messageCount = isNormalThread(thread) ? 4 + (thread.index % 2) : 2;
        globalOrder += 1;
      }

      const { error: progressErr } = await supabase.rpc('refresh_campaign_interval_progress_for_ids', {
        p_interval_ids: [intervalId],
      });
      if (progressErr) {
        throw new Error(
          `ooo-mixed-inbox: refresh_campaign_interval_progress_for_ids failed: ${progressErr.message}`
        );
      }
    }

    // Phase 2 — runtime-ready intervals: historical 2099 slots are fully completed, which
    // would pin `ensureCampaignIntervals` / batch assignment years in the future. Replace
    // with near-now rows so resume → scheduler → batchAssignIntervalJobs can create email-2.
    await detachMessageJobsFromIntervalsThenDeleteIntervals(ctx);
    await insertRuntimeReadyCampaignIntervals(ctx);

    ctx.log(
      `ooo base graph ready campaign=${oooStore.campaignId} threads=${oooStore.threads.length} jobsCreated=${jobsCreatedTotal} historicalIntervals=${intervalBatches.length} runtimeIntervals=${OOO_RUNTIME_INTERVAL_COUNT} multiEmail=true`
    );
  },
};

export const oooInboxThreadsModule: SeedModule = {
  id: 'oooInbox_threads',
  description: 'Insert deterministic bulk inbox threads',
  deps: ['oooInbox_baseGraph'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would insert ${oooStore.threads.length} mixed inbox threads for campaign=${oooStore.campaignId}`
      );
      return;
    }

    const rows = oooStore.threads.map((thread) => ({
      id: thread.threadId,
      account_id: oooStore.accountId,
      campaign_id: oooStore.campaignId,
      lead_id: thread.leadId,
      enrollment_id: thread.enrollmentId,
      message_job_id: thread.messageJobId,
      mailbox_id: thread.mailboxId,
      subject: caseCopy(thread.key).subject,
      participants: [thread.mailboxEmail, thread.leadEmail],
      last_message_at: thread.lastMessageAt,
      message_count: thread.messageCount,
      has_reply: true,
      out_of_office: false,
      ooo_resume_requested: false,
      ooo_resume_at: null,
      ooo_resume_processed_at: null,
      created_at: thread.sentAt,
      updated_at: thread.lastMessageAt,
    }));

    const { error } = await ctx.supabase.from('email_threads').insert(rows);
    if (error) {
      throw new Error(`ooo-mixed-inbox: email_threads insert failed: ${error.message}`);
    }

    ctx.log(`threads inserted count=${rows.length}`);
  },
};

export const oooInboxMessagesModule: SeedModule = {
  id: 'oooInbox_messages',
  description: 'Insert bulk email_messages for previews, unread state, and OOO date prefill',
  deps: ['oooInbox_threads'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would insert email_messages for ${oooStore.threads.length} threads in campaign=${oooStore.campaignId}`
      );
      return;
    }

    const rows: Record<string, unknown>[] = [];
    for (const thread of oooStore.threads) {
      const copy = caseCopy(thread.key);
      const sentMessageId = headerMessageId(thread.key, thread.index, 'sent');
      const firstReplyId = headerMessageId(thread.key, thread.index, 'received');

      rows.push(
        {
          thread_id: thread.threadId,
          account_id: oooStore.accountId,
          message_job_id: thread.messageJobId,
          direction: 'sent',
          from_email: thread.mailboxEmail,
          from_name: copy.mailboxDisplayName,
          to_email: thread.leadEmail,
          to_name: thread.leadName,
          subject: copy.subject,
          body_text: copy.sentBody.replace('{{name}}', thread.leadFirstName),
          body_html: null,
          message_id: sentMessageId,
          in_reply_to: null,
          message_references: null,
          received_at: thread.sentAt,
          read_at: thread.sentAt,
          headers: {},
          attachments: [],
          created_at: thread.sentAt,
          updated_at: thread.sentAt,
        },
        {
          thread_id: thread.threadId,
          account_id: oooStore.accountId,
          message_job_id: null,
          direction: 'received',
          from_email: thread.leadEmail,
          from_name: thread.leadName,
          to_email: thread.mailboxEmail,
          to_name: copy.mailboxDisplayName,
          subject: copy.subject,
          body_text: oooReceivedBodyForIndex(thread.key, thread.index),
          body_html: null,
          message_id: firstReplyId,
          in_reply_to: sentMessageId,
          message_references: sentMessageId,
          received_at: thread.replyAt,
          read_at: thread.unread ? null : thread.replyAt,
          headers: {},
          attachments: [],
          created_at: thread.replyAt,
          updated_at: thread.replyAt,
        }
      );

      if (isNormalThread(thread)) {
        const followSentAt = new Date(Date.parse(thread.replyAt) + 18 * 60 * 1000).toISOString();
        const followReplyAt = new Date(Date.parse(followSentAt) + 18 * 60 * 1000).toISOString();
        rows.push(
          {
            thread_id: thread.threadId,
            account_id: oooStore.accountId,
            message_job_id: null,
            direction: 'sent',
            from_email: thread.mailboxEmail,
            from_name: copy.mailboxDisplayName,
            to_email: thread.leadEmail,
            to_name: thread.leadName,
            subject: copy.subject,
            body_text: `Quick checkpoint for batch ${thread.index}: still good to move forward on the wasteland route?`,
            body_html: null,
            message_id: headerMessageId(thread.key, thread.index, 'followup'),
            in_reply_to: firstReplyId,
            message_references: `${sentMessageId} ${firstReplyId}`,
            received_at: followSentAt,
            read_at: followSentAt,
            headers: {},
            attachments: [],
            created_at: followSentAt,
            updated_at: followSentAt,
          },
          {
            thread_id: thread.threadId,
            account_id: oooStore.accountId,
            message_job_id: null,
            direction: 'received',
            from_email: thread.leadEmail,
            from_name: thread.leadName,
            to_email: thread.mailboxEmail,
            to_name: copy.mailboxDisplayName,
            subject: copy.subject,
            body_text: `Confirmed for route batch ${thread.index}. The settlement team is ready for the next step.`,
            body_html: null,
            message_id: `${headerMessageId(thread.key, thread.index, 'followup')}.reply`,
            in_reply_to: headerMessageId(thread.key, thread.index, 'followup'),
            message_references: `${sentMessageId} ${firstReplyId} ${headerMessageId(thread.key, thread.index, 'followup')}`,
            received_at: followReplyAt,
            read_at: thread.unread ? null : followReplyAt,
            headers: {},
            attachments: [],
            created_at: followReplyAt,
            updated_at: followReplyAt,
          }
        );

        if (thread.index % 2 === 0) {
          const finalReplyAt = new Date(Date.parse(followReplyAt) + 18 * 60 * 1000).toISOString();
          rows.push({
            thread_id: thread.threadId,
            account_id: oooStore.accountId,
            message_job_id: null,
            direction: 'received',
            from_email: thread.leadEmail,
            from_name: thread.leadName,
            to_email: thread.mailboxEmail,
            to_name: copy.mailboxDisplayName,
            subject: copy.subject,
            body_text: `One last wasteland note for batch ${thread.index}: send the final packet when the brahmin cart clears customs.`,
            body_html: null,
            message_id: `${headerMessageId(thread.key, thread.index, 'followup')}.final`,
            in_reply_to: `${headerMessageId(thread.key, thread.index, 'followup')}.reply`,
            message_references: `${sentMessageId} ${firstReplyId}`,
            received_at: finalReplyAt,
            read_at: thread.unread ? null : finalReplyAt,
            headers: {},
            attachments: [],
            created_at: finalReplyAt,
            updated_at: finalReplyAt,
          });
        }
      }
    }

    const { error } = await ctx.supabase.from('email_messages').insert(rows);
    if (error) {
      throw new Error(`ooo-mixed-inbox: email_messages insert failed: ${error.message}`);
    }

    ctx.log(`messages inserted count=${rows.length}`);
  },
};

export const oooInboxOooStatesModule: SeedModule = {
  id: 'oooInbox_oooStates',
  description: 'Record metrics inputs and apply bulk OOO flags',
  deps: ['oooInbox_messages'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would record events/stats and apply OOO state to ${oooStore.threads.length} seeded threads for campaign=${oooStore.campaignId}`
      );
      return;
    }

    for (const thread of oooStore.threads) {
      await seedThreadEventsAndStats(ctx, thread);
    }

    const stoppedAt = new Date().toISOString();
    for (const thread of oooStore.threads.filter((row) => row.key !== 'normal')) {
      const { error } = await ctx.supabase
        .from('enrollments')
        .update({
          current_node_id: oooStore.waitNodeDbId,
          state: 'stopped',
          stopped_reason: 'replied',
          stopped_at: stoppedAt,
          next_run_at: null,
          updated_at: stoppedAt,
        })
        .eq('id', thread.enrollmentId);
      if (error) {
        throw new Error(
          `ooo-mixed-inbox: enrollment stop failed for ${thread.key}#${thread.index}: ${error.message}`
        );
      }
    }

    for (const thread of oooStore.threads.filter((row) => row.key === 'ooo_only')) {
      await markThreadOutOfOffice(ctx, thread.threadId, true, false, null);
    }

    for (const thread of oooStore.threads.filter((row) => row.key === 'ooo_future')) {
      const futureResumeAt = `2099-07-${String(20 + ((thread.index - 1) % 5)).padStart(2, '0')}T12:00:00.000Z`;
      await markThreadOutOfOffice(ctx, thread.threadId, true, true, futureResumeAt);
    }

    for (const thread of oooStore.threads.filter((row) => row.key === 'ooo_due')) {
      const { error: dueErr } = await ctx.supabase
        .from('email_threads')
        .update({
          out_of_office: true,
          ooo_resume_requested: true,
          ooo_resume_at: `2000-01-${String(1 + ((thread.index - 1) % 5)).padStart(2, '0')}T12:00:00.000Z`,
          ooo_resume_processed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.threadId);
      if (dueErr) {
        throw new Error(
          `ooo-mixed-inbox: due OOO direct update failed for #${thread.index}: ${dueErr.message}`
        );
      }
    }

    ctx.log(
      `OOO states + metrics applied counts=normal:${oooStore.threads.filter((t) => t.key === 'normal').length},` +
        `ooo_only:${oooStore.threads.filter((t) => t.key === 'ooo_only').length},` +
        `future:${oooStore.threads.filter((t) => t.key === 'ooo_future').length},` +
        `due:${oooStore.threads.filter((t) => t.key === 'ooo_due').length}`
    );
  },
};
