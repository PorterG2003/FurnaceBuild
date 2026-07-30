import type { Json } from '../../../../lib/supabase/types/database';
import type { SeedContext, SeedModule } from '../../types';
import { smokeSchedule } from '../campaign-smoke/buildFlow';

/**
 * categorizer-flow — pre-prod gate scenario for the Categorizer node.
 *
 * Seeds one RUNNING campaign whose flow contains a categorizer (AI on) plus
 * one lead per reply type, each with a real replied thread, then routes every
 * replied enrollment through the real `park_or_advance_enrollment_on_reply`
 * RPC. The live dev scheduler worker then runs the REAL classify path
 * (OpenRouter, cheap model) — this is the one place the true LLM transport is
 * exercised before production.
 *
 * Cases (one lead each):
 *   - interested      -> AI should classify 'Interested', branch to the reply-mode email
 *   - neutral         -> 'Neutral', branch to the reply-mode nudge
 *   - not_interested  -> 'Not Interested', branch to the breakup email
 *   - ooo_dated       -> headerless OOO with an explicit return date -> 'Auto Reply',
 *                        held email-2 restored at the extracted date
 *   - ooo_system      -> header-stamped Auto Reply (category_source='system', no date
 *                        in the body) -> extraction resolves no date -> resume now
 *   - no_reply        -> control; never parked, email-2 proceeds normally
 *
 * Verification: docs/implementation/flow/CATEGORIZER_VERIFICATION.md
 */

export const DEFAULT_SEED_CATEGORIZER_CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000c701';

const SEED_SOURCE = 'seed:categorizer-flow';
const SENDING_INTERVAL_SECONDS = 300;
const RUNTIME_INTERVAL_COUNT = 28;

const VARIANT_IDS = {
  email1: 'f0000000-0000-4000-8000-00000000c711',
  email2: 'f0000000-0000-4000-8000-00000000c712',
  interestedReply: 'f0000000-0000-4000-8000-00000000c713',
  neutralReply: 'f0000000-0000-4000-8000-00000000c714',
  breakup: 'f0000000-0000-4000-8000-00000000c715',
} as const;

const CATEGORIZER_FLOW_NODE_ID = 'aiCategorizer-1';

type CategorizerCaseKey =
  | 'interested'
  | 'neutral'
  | 'not_interested'
  | 'ooo_dated'
  | 'ooo_system'
  | 'no_reply';

interface CategorizerCase {
  key: CategorizerCaseKey;
  subjectTag: string;
  leadFirstName: string;
  leadLastName: string;
  company: string;
  hasReply: boolean;
  /** Pre-stamped category (simulates inbox-checker header detection). */
  prestampCategory?: 'Auto Reply';
  replyBody?: (returnDateHuman: string) => string;
}

const CASES: CategorizerCase[] = [
  {
    key: 'interested',
    subjectTag: '[INTERESTED]',
    leadFirstName: 'Sarah',
    leadLastName: 'Holloway',
    company: 'Brightline Manufacturing',
    hasReply: true,
    replyBody: () =>
      'This looks very relevant to what we are working on this quarter. Can you send over pricing and a couple of times to talk this week?',
  },
  {
    key: 'neutral',
    subjectTag: '[NEUTRAL]',
    leadFirstName: 'Marcus',
    leadLastName: 'Trent',
    company: 'Coldwater Logistics',
    hasReply: true,
    replyBody: () =>
      'Thanks for reaching out. Can you share more details on how this works? We might look at this next quarter but nothing is decided yet.',
  },
  {
    key: 'not_interested',
    subjectTag: '[NOT INTERESTED]',
    leadFirstName: 'Dana',
    leadLastName: 'Whitfield',
    company: 'Ironvale Supply',
    hasReply: true,
    replyBody: () =>
      'Not interested, please remove me from your list. We already have a vendor for this.',
  },
  {
    key: 'ooo_dated',
    subjectTag: '[OOO DATED]',
    leadFirstName: 'Priya',
    leadLastName: 'Raman',
    company: 'Meridian Freight',
    hasReply: true,
    replyBody: (returnDateHuman) =>
      `Thank you for your email. I am out of the office until ${returnDateHuman} with limited access to email. I will respond to your message when I return.`,
  },
  {
    key: 'ooo_system',
    subjectTag: '[OOO SYSTEM]',
    leadFirstName: 'Tomas',
    leadLastName: 'Eriksen',
    company: 'Northgate Partners',
    hasReply: true,
    prestampCategory: 'Auto Reply',
    replyBody: () =>
      'I am currently out of the office with no access to email. For urgent matters please contact our main line.',
  },
  {
    key: 'no_reply',
    subjectTag: '[NO REPLY]',
    leadFirstName: 'Elena',
    leadLastName: 'Vasquez',
    company: 'Stonebridge Analytics',
    hasReply: false,
  },
];

function buildCategorizerFlowData(): Json {
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Gate Lead Source' },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'Initial Touch',
          priority: false,
          variants: [
            {
              id: VARIANT_IDS.email1,
              label: 'Gate Opener',
              subject: 'Quick question about {{company_name}}, {{first_name}}',
              template:
                'Hi {{first_name}} - quick dev-only categorizer gate check-in about {{company_name}}. Worth a short call?',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'email-2',
        type: 'email',
        position: { x: 700, y: 0 },
        data: {
          label: 'Follow-up',
          priority: false,
          variants: [
            {
              id: VARIANT_IDS.email2,
              label: 'Gate Follow-up',
              subject: 'Following up, {{first_name}}',
              template:
                'Hi {{first_name}} - following up on my last note about {{company_name}}. Any thoughts?',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: CATEGORIZER_FLOW_NODE_ID,
        type: 'aiCategorizer',
        position: { x: 940, y: 0 },
        data: {
          label: 'Categorizer',
          use_ai: true,
        },
      },
      {
        id: 'email-3',
        type: 'email',
        position: { x: 1180, y: -160 },
        data: {
          label: 'Interested Reply',
          priority: true,
          variants: [
            {
              id: VARIANT_IDS.interestedReply,
              label: 'Interested In-Thread Reply',
              subject: '',
              template:
                'Hi {{first_name}} - great to hear back! Sending over the details now; happy to find a time this week.',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'email-4',
        type: 'email',
        position: { x: 1180, y: 0 },
        data: {
          label: 'Neutral Nudge',
          priority: true,
          variants: [
            {
              id: VARIANT_IDS.neutralReply,
              label: 'Neutral In-Thread Reply',
              subject: '',
              template:
                'Hi {{first_name}} - of course, here is a bit more detail. Would a short overview call be useful?',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'email-5',
        type: 'email',
        position: { x: 1180, y: 160 },
        data: {
          label: 'Breakup',
          priority: true,
          variants: [
            {
              id: VARIANT_IDS.breakup,
              label: 'Breakup Note',
              subject: 'Closing the loop, {{first_name}}',
              template:
                'Hi {{first_name}} - totally understood, closing the loop on my end. All the best!',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'leadSource-1', target: 'email-1' },
      { id: 'e2', source: 'email-1', target: 'email-2' },
      { id: 'e3', source: 'email-2', target: CATEGORIZER_FLOW_NODE_ID },
      {
        id: 'e5',
        source: CATEGORIZER_FLOW_NODE_ID,
        sourceHandle: 'interested',
        target: 'email-3',
      },
      {
        id: 'e6',
        source: CATEGORIZER_FLOW_NODE_ID,
        sourceHandle: 'neutral',
        target: 'email-4',
      },
      {
        id: 'e7',
        source: CATEGORIZER_FLOW_NODE_ID,
        sourceHandle: 'not-interested',
        target: 'email-5',
      },
    ],
  } as unknown as Json;
}

type CaseState = CategorizerCase & {
  leadId: string;
  leadEmail: string;
  leadName: string;
  enrollmentId: string;
  sentJobId: string;
  queuedJobId: string;
  threadId: string;
  sentAt: string;
  replyAt: string;
};

const store: {
  accountId: string;
  ownerUserId: string;
  campaignId: string;
  bucketId: string;
  mailboxId: string;
  mailboxEmail: string;
  nodeIdsByFlowNodeId: Map<string, string>;
  cases: CaseState[];
  returnDateIso: string;
  returnDateHuman: string;
} = {
  accountId: '',
  ownerUserId: '',
  campaignId: '',
  bucketId: '',
  mailboxId: '',
  mailboxEmail: '',
  nodeIdsByFlowNodeId: new Map(),
  cases: [],
  returnDateIso: '',
  returnDateHuman: '',
};

function resetStore() {
  store.accountId = '';
  store.ownerUserId = '';
  store.campaignId = '';
  store.bucketId = '';
  store.mailboxId = '';
  store.mailboxEmail = '';
  store.nodeIdsByFlowNodeId = new Map();
  store.cases = [];
  store.returnDateIso = '';
  store.returnDateHuman = '';
}

function headerMessageId(key: CategorizerCaseKey, kind: 'sent' | 'received'): string {
  return `<seed-categorizer-${store.campaignId.slice(0, 8)}-${key}-${kind}@furnace.test>`;
}

function caseSubject(c: CategorizerCase): string {
  return `${c.subjectTag} Quick question about ${c.company}, ${c.leadFirstName}`;
}

async function pollNodeId(ctx: SeedContext, flowNodeId: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { data, error } = await ctx.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', store.campaignId)
      .eq('flow_node_id', flowNodeId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      throw new Error(`categorizer-flow: node poll failed for ${flowNodeId}: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`categorizer-flow: timed out waiting for node sync (${flowNodeId})`);
}

async function cleanupCampaignSlice(ctx: SeedContext) {
  const { supabase } = ctx;

  const { error: delEventsErr } = await supabase
    .from('events')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delEventsErr) {
    throw new Error(`categorizer-flow: events cleanup failed: ${delEventsErr.message}`);
  }

  const { error: delStatsErr } = await supabase
    .from('campaign_stats')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delStatsErr) {
    throw new Error(`categorizer-flow: campaign_stats cleanup failed: ${delStatsErr.message}`);
  }

  const { data: threads, error: threadErr } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', store.campaignId);
  if (threadErr) {
    throw new Error(`categorizer-flow: thread cleanup lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threads ?? []).map((row) => row.id as string);
  if (threadIds.length > 0) {
    const { error: msgErr } = await supabase.from('email_messages').delete().in('thread_id', threadIds);
    if (msgErr) {
      throw new Error(`categorizer-flow: email_messages cleanup failed: ${msgErr.message}`);
    }
  }

  const { error: delThreadErr } = await supabase
    .from('email_threads')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delThreadErr) {
    throw new Error(`categorizer-flow: email_threads cleanup failed: ${delThreadErr.message}`);
  }

  const { error: delJobsErr } = await supabase
    .from('message_jobs')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delJobsErr) {
    throw new Error(`categorizer-flow: message_jobs cleanup failed: ${delJobsErr.message}`);
  }

  const { error: delEnrErr } = await supabase
    .from('enrollments')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delEnrErr) {
    throw new Error(`categorizer-flow: enrollments cleanup failed: ${delEnrErr.message}`);
  }

  const { error: delLeadErr } = await supabase
    .from('leads')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delLeadErr) {
    throw new Error(`categorizer-flow: leads cleanup failed: ${delLeadErr.message}`);
  }

  const { error: delLinkErr } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delLinkErr) {
    throw new Error(`categorizer-flow: campaign_mailboxes cleanup failed: ${delLinkErr.message}`);
  }

  const { error: delIntervalErr } = await supabase
    .from('campaign_intervals')
    .delete()
    .eq('campaign_id', store.campaignId);
  if (delIntervalErr) {
    throw new Error(`categorizer-flow: campaign_intervals cleanup failed: ${delIntervalErr.message}`);
  }
}

async function ensureMailbox(ctx: SeedContext): Promise<{ id: string; email: string }> {
  const { supabase } = ctx;
  const email = `categorizer-gate-${store.campaignId.slice(0, 8)}@furnace.test`;
  const now = new Date().toISOString();

  const { data: found, error: findErr } = await supabase
    .from('mailboxes')
    .select('id')
    .eq('email_address', email)
    .maybeSingle();
  if (findErr) {
    throw new Error(`categorizer-flow: mailbox lookup failed: ${findErr.message}`);
  }

  if (found?.id) {
    const { error: upErr } = await supabase
      .from('mailboxes')
      .update({
        account_id: store.accountId,
        user_id: store.ownerUserId,
        display_name: 'Categorizer Gate',
        status: 'connected',
        smtp_status: 'active',
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', found.id);
    if (upErr) {
      throw new Error(`categorizer-flow: mailbox update failed: ${upErr.message}`);
    }
    return { id: found.id as string, email };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('mailboxes')
    .insert({
      account_id: store.accountId,
      user_id: store.ownerUserId,
      email_address: email,
      display_name: 'Categorizer Gate',
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
      smtp_status: 'active',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    throw new Error(`categorizer-flow: mailbox insert failed: ${insErr?.message}`);
  }
  return { id: inserted.id as string, email };
}

/** Re-arm reply-mode enrollments deferred by mailbox-unavailable handling. */
async function wakeDeferredReplyModeEnrollments(ctx: SeedContext) {
  const { supabase } = ctx;
  const now = new Date().toISOString();
  const { data: replyNodes, error: nodeErr } = await supabase
    .from('nodes')
    .select('id')
    .eq('campaign_id', store.campaignId)
    .eq('node_type', 'email')
    .contains('node_data', { priority: true });
  if (nodeErr) {
    throw new Error(`categorizer-flow: reply node lookup failed: ${nodeErr.message}`);
  }
  const replyNodeIds = (replyNodes ?? []).map((n) => n.id as string);
  if (replyNodeIds.length === 0) return;

  const { error: wakeErr } = await supabase
    .from('enrollments')
    .update({ next_run_at: now, updated_at: now })
    .eq('campaign_id', store.campaignId)
    .eq('state', 'active')
    .not('reply_thread_id', 'is', null)
    .in('current_node_id', replyNodeIds);
  if (wakeErr) {
    throw new Error(`categorizer-flow: wake reply enrollments failed: ${wakeErr.message}`);
  }
}

async function insertRuntimeReadyCampaignIntervals(ctx: SeedContext) {
  const { supabase } = ctx;
  const base = Date.now() + 60_000;
  const rows = Array.from({ length: RUNTIME_INTERVAL_COUNT }, (_, index) => ({
    campaign_id: store.campaignId,
    account_id: store.accountId,
    interval_time: new Date(base + index * SENDING_INTERVAL_SECONDS * 1000).toISOString(),
    status: 'available' as const,
    required_mailbox_count: 0,
  }));

  const { error } = await supabase.from('campaign_intervals').insert(rows);
  if (error) {
    throw new Error(`categorizer-flow: runtime campaign_intervals insert failed: ${error.message}`);
  }
}

export const categorizerFlowEnvModule: SeedModule = {
  id: 'categorizerFlow_env',
  description: 'Validate env and initialize categorizer-flow store',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'categorizer-flow requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).'
      );
    }
    resetStore();
    store.accountId = accountId;
    store.ownerUserId = ownerUserId;
    store.campaignId =
      process.env.SEED_CATEGORIZER_CAMPAIGN_ID?.trim() || DEFAULT_SEED_CATEGORIZER_CAMPAIGN_ID;

    const returnDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    store.returnDateIso = returnDate.toISOString().slice(0, 10);
    store.returnDateHuman = returnDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would use accountId=${accountId} ownerUserId=${ownerUserId} campaignId=${store.campaignId} cases=${CASES.length} oooReturnDate=${store.returnDateIso}`
      );
    }
  },
};

export const categorizerFlowBaseGraphModule: SeedModule = {
  id: 'categorizerFlow_baseGraph',
  description: 'Create campaign/mailbox/leads/enrollments/jobs for the categorizer gate',
  deps: ['categorizerFlow_env'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would build categorizer gate graph for campaign=${store.campaignId}`);
      return;
    }

    const now = new Date().toISOString();
    const { supabase } = ctx;
    const flowData = buildCategorizerFlowData();
    const schedule = smokeSchedule();

    const { data: existing, error: selErr } = await supabase
      .from('campaigns')
      .select('id, bucket_id')
      .eq('id', store.campaignId)
      .maybeSingle();
    if (selErr) {
      throw new Error(`categorizer-flow: campaign lookup failed: ${selErr.message}`);
    }

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('campaigns')
        .update({
          name: `Categorizer Gate (${store.campaignId.slice(0, 8)})`,
          owner_id: store.ownerUserId,
          account_id: store.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: SENDING_INTERVAL_SECONDS,
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', store.campaignId);
      if (upErr) {
        throw new Error(`categorizer-flow: campaign update failed: ${upErr.message}`);
      }
      store.bucketId = (existing.bucket_id as string) || '';
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('campaigns')
        .insert({
          id: store.campaignId,
          name: `Categorizer Gate (${store.campaignId.slice(0, 8)})`,
          owner_id: store.ownerUserId,
          account_id: store.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: SENDING_INTERVAL_SECONDS,
          created_at: now,
          updated_at: now,
        })
        .select('bucket_id')
        .single();
      if (insErr || !inserted) {
        throw new Error(`categorizer-flow: campaign insert failed: ${insErr?.message}`);
      }
      store.bucketId = inserted.bucket_id as string;
    }

    if (!store.bucketId) {
      const { data: row, error: bucketErr } = await supabase
        .from('campaigns')
        .select('bucket_id')
        .eq('id', store.campaignId)
        .single();
      if (bucketErr || !row?.bucket_id) {
        throw new Error(`categorizer-flow: missing bucket_id: ${bucketErr?.message}`);
      }
      store.bucketId = row.bucket_id as string;
    }

    await cleanupCampaignSlice(ctx);

    const mailbox = await ensureMailbox(ctx);
    store.mailboxId = mailbox.id;
    store.mailboxEmail = mailbox.email;

    const { error: linkErr } = await supabase.from('campaign_mailboxes').insert({
      campaign_id: store.campaignId,
      mailbox_id: mailbox.id,
      account_id: store.accountId,
    });
    if (linkErr) {
      throw new Error(`categorizer-flow: campaign_mailboxes insert failed: ${linkErr.message}`);
    }

    for (const flowNodeId of [
      'email-1',
      'email-2',
      CATEGORIZER_FLOW_NODE_ID,
      'email-3',
      'email-4',
      'email-5',
    ]) {
      store.nodeIdsByFlowNodeId.set(flowNodeId, await pollNodeId(ctx, flowNodeId));
    }

    const email1NodeId = store.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = store.nodeIdsByFlowNodeId.get('email-2')!;

    const baseTime = Date.now() - 6 * 60 * 60 * 1000;
    let order = 0;
    for (const seedCase of CASES) {
      const leadEmail = `categorizer-${seedCase.key.replace(/_/g, '-')}-${store.campaignId.slice(0, 8)}@furnace.test`;
      const leadName = `${seedCase.leadFirstName} ${seedCase.leadLastName}`;

      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          campaign_id: store.campaignId,
          bucket_id: store.bucketId,
          account_id: store.accountId,
          email: leadEmail,
          name: leadName,
          first_name: seedCase.leadFirstName,
          last_name: seedCase.leadLastName,
          company_name: seedCase.company,
          source: SEED_SOURCE,
          mailbox_id: store.mailboxId,
        })
        .select('id')
        .single();
      if (leadErr || !lead) {
        throw new Error(`categorizer-flow: lead insert failed (${seedCase.key}): ${leadErr?.message}`);
      }

      const nextRunAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { data: enrollment, error: enrErr } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: store.campaignId,
          account_id: store.accountId,
          lead_id: lead.id,
          current_node_id: email2NodeId,
          state: 'active',
          next_run_at: nextRunAt,
          flow_position: {},
        })
        .select('id')
        .single();
      if (enrErr || !enrollment) {
        throw new Error(`categorizer-flow: enrollment insert failed (${seedCase.key}): ${enrErr?.message}`);
      }

      const sentAt = new Date(baseTime + order * 10 * 60 * 1000).toISOString();
      const replyAt = new Date(Date.parse(sentAt) + 25 * 60 * 1000).toISOString();
      const messageData = {
        node_config: {},
        lead_data: {
          email: leadEmail,
          name: leadName,
          first_name: seedCase.leadFirstName,
          last_name: seedCase.leadLastName,
          company_name: seedCase.company,
        },
      };

      const { data: sentJob, error: sentJobErr } = await supabase
        .from('message_jobs')
        .insert({
          enrollment_id: enrollment.id,
          campaign_id: store.campaignId,
          account_id: store.accountId,
          lead_id: lead.id,
          mailbox_id: store.mailboxId,
          node_id: email1NodeId,
          status: 'sent',
          status_reason: 'sent_successfully',
          scheduled_at: sentAt,
          sent_at: sentAt,
          provider_message_id: headerMessageId(seedCase.key, 'sent'),
          message_data: messageData,
          message_type: 'campaign',
        })
        .select('id')
        .single();
      if (sentJobErr || !sentJob) {
        throw new Error(`categorizer-flow: sent job insert failed (${seedCase.key}): ${sentJobErr?.message}`);
      }

      // Queued follow-up: held by the park RPC on reply, then cancelled
      // (branch) or restored (Auto Reply) by the real scheduler.
      const { data: queuedJob, error: queuedJobErr } = await supabase
        .from('message_jobs')
        .insert({
          enrollment_id: enrollment.id,
          campaign_id: store.campaignId,
          account_id: store.accountId,
          lead_id: lead.id,
          mailbox_id: store.mailboxId,
          node_id: email2NodeId,
          status: 'queued',
          scheduled_at: nextRunAt,
          message_data: messageData,
          message_type: 'campaign',
        })
        .select('id')
        .single();
      if (queuedJobErr || !queuedJob) {
        throw new Error(`categorizer-flow: queued job insert failed (${seedCase.key}): ${queuedJobErr?.message}`);
      }

      store.cases.push({
        ...seedCase,
        leadId: lead.id as string,
        leadEmail,
        leadName,
        enrollmentId: enrollment.id as string,
        sentJobId: sentJob.id as string,
        queuedJobId: queuedJob.id as string,
        threadId: '',
        sentAt,
        replyAt,
      });
      order += 1;
    }

    await insertRuntimeReadyCampaignIntervals(ctx);

    ctx.log(
      `categorizer gate graph ready campaign=${store.campaignId} cases=${store.cases.length} runtimeIntervals=${RUNTIME_INTERVAL_COUNT}`
    );
  },
};

export const categorizerFlowRepliesModule: SeedModule = {
  id: 'categorizerFlow_replies',
  description: 'Insert replied threads/messages and route enrollments through the park RPC',
  deps: ['categorizerFlow_baseGraph'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would insert replied threads for ${CASES.filter((c) => c.hasReply).length} cases and call park_or_advance_enrollment_on_reply`
      );
      return;
    }

    const { supabase } = ctx;

    for (const seedCase of store.cases) {
      if (!seedCase.hasReply) {
        continue;
      }

      const subject = caseSubject(seedCase);
      const sentMessageId = headerMessageId(seedCase.key, 'sent');
      const replyMessageId = headerMessageId(seedCase.key, 'received');

      const { data: thread, error: threadErr } = await supabase
        .from('email_threads')
        .insert({
          account_id: store.accountId,
          campaign_id: store.campaignId,
          lead_id: seedCase.leadId,
          enrollment_id: seedCase.enrollmentId,
          message_job_id: seedCase.sentJobId,
          mailbox_id: store.mailboxId,
          subject,
          participants: [store.mailboxEmail, seedCase.leadEmail],
          last_message_at: seedCase.replyAt,
          last_inbound_at: seedCase.replyAt,
          message_count: 2,
          has_reply: true,
          category: seedCase.prestampCategory ?? null,
          category_source: seedCase.prestampCategory ? 'system' : null,
          created_at: seedCase.sentAt,
          updated_at: seedCase.replyAt,
        })
        .select('id')
        .single();
      if (threadErr || !thread) {
        throw new Error(`categorizer-flow: thread insert failed (${seedCase.key}): ${threadErr?.message}`);
      }
      seedCase.threadId = thread.id as string;

      const replyBody = seedCase.replyBody!(store.returnDateHuman);
      const { error: messagesErr } = await supabase.from('email_messages').insert([
        {
          thread_id: seedCase.threadId,
          account_id: store.accountId,
          message_job_id: seedCase.sentJobId,
          direction: 'sent',
          from_email: store.mailboxEmail,
          from_name: 'Categorizer Gate',
          to_email: seedCase.leadEmail,
          to_name: seedCase.leadName,
          subject,
          body_text: `Hi ${seedCase.leadFirstName} - quick dev-only categorizer gate check-in about ${seedCase.company}. Worth a short call?`,
          body_html: null,
          message_id: sentMessageId,
          in_reply_to: null,
          message_references: null,
          received_at: seedCase.sentAt,
          read_at: seedCase.sentAt,
          headers: {},
          attachments: [],
          created_at: seedCase.sentAt,
          updated_at: seedCase.sentAt,
        },
        {
          thread_id: seedCase.threadId,
          account_id: store.accountId,
          message_job_id: null,
          direction: 'received',
          from_email: seedCase.leadEmail,
          from_name: seedCase.leadName,
          to_email: store.mailboxEmail,
          to_name: 'Categorizer Gate',
          subject: `Re: ${subject}`,
          body_text: replyBody,
          body_html: null,
          message_id: replyMessageId,
          in_reply_to: sentMessageId,
          message_references: sentMessageId,
          received_at: seedCase.replyAt,
          read_at: null,
          headers: {},
          attachments: [],
          created_at: seedCase.replyAt,
          updated_at: seedCase.replyAt,
        },
      ]);
      if (messagesErr) {
        throw new Error(`categorizer-flow: email_messages insert failed (${seedCase.key}): ${messagesErr.message}`);
      }

      // Metrics through the same RPCs the workers use.
      const { error: sentEventErr } = await supabase.rpc('record_sent_event_and_increment', {
        p_campaign_id: store.campaignId,
        p_lead_id: seedCase.leadId,
        p_enrollment_id: seedCase.enrollmentId,
        p_message_job_id: seedCase.sentJobId,
        p_event_data: {
          provider_message_id: sentMessageId,
          sent_at: seedCase.sentAt,
          source: SEED_SOURCE,
        },
      });
      if (sentEventErr) {
        throw new Error(`categorizer-flow: record_sent_event failed (${seedCase.key}): ${sentEventErr.message}`);
      }

      const { error: repliedEventErr } = await supabase.rpc('record_replied_event_and_increment', {
        p_campaign_id: store.campaignId,
        p_lead_id: seedCase.leadId,
        p_enrollment_id: seedCase.enrollmentId,
        p_message_job_id: seedCase.sentJobId,
        p_event_data: { detected_at: seedCase.replyAt, source: SEED_SOURCE },
        p_is_positive: false,
      });
      if (repliedEventErr) {
        throw new Error(`categorizer-flow: record_replied_event failed (${seedCase.key}): ${repliedEventErr.message}`);
      }

      // The real reply route: hold the queued follow-up, snapshot position,
      // fast-forward to the categorizer, and wake the enrollment so the live
      // scheduler classifies it through the real OpenRouter path.
      const { data: parkStatus, error: parkErr } = await supabase.rpc(
        'park_or_advance_enrollment_on_reply',
        {
          p_enrollment_id: seedCase.enrollmentId,
          p_thread_id: seedCase.threadId,
        }
      );
      if (parkErr) {
        throw new Error(`categorizer-flow: park RPC failed (${seedCase.key}): ${parkErr.message}`);
      }
      if (parkStatus !== 'held') {
        throw new Error(
          `categorizer-flow: park RPC returned '${parkStatus}' for ${seedCase.key} (expected 'held')`
        );
      }

      ctx.log(`case ${seedCase.key}: thread=${seedCase.threadId} park=held`);
    }

    await wakeDeferredReplyModeEnrollments(ctx);

    ctx.log(
      `categorizer gate replies seeded: ${store.cases.filter((c) => c.hasReply).length} parked at the categorizer, ` +
        `1 no-reply control. Watch the dev scheduler classify within ~1 minute ` +
        `(ooo_dated should restore at ${store.returnDateIso}). ` +
        `Verification SQL: docs/implementation/flow/CATEGORIZER_VERIFICATION.md`
    );
  },
};
