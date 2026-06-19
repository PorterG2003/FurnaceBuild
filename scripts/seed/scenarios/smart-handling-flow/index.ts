import { randomUUID } from 'node:crypto';
import type { Json } from '../../../../lib/supabase/types/database';
import type { SeedContext, SeedModule } from '../../types';
import {
  DEFAULT_SEED_SMART_HANDLING_AI_CAMPAIGN_ID,
  DEFAULT_SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID,
  smartHandlingMailboxLocalPart,
} from '../../constants/smartHandlingFlow';
import { smokeSchedule } from '../campaign-smoke/buildFlow';
import {
  buildSeedAiMetadata,
  buildSeedInterestedMetadata,
  buildSeedNeutralMetadata,
  buildSeedNotInterestedMetadata,
  buildSeedOooDatedMetadata,
  buildSeedOooNoDateMetadata,
  buildSeedWrongContactMetadata,
} from './payloads';
import { ThreadManager } from '../../../../workers/inbox-checker-worker/src/thread-manager';
import type { Mailbox, ProcessedMessage } from '../../../../workers/inbox-checker-worker/src/types';
import { handler as classifyReplyHandler } from '../../../../amplify/functions/classifyReply/handler';

const SEED_SOURCE = 'seed:smart-handling-flow';
const NODE_SYNC_TIMEOUT_MS = 30_000;
const NODE_SYNC_POLL_MS = 250;
const SENDING_INTERVAL_SECONDS = 300;

const VARIANT_IDS = {
  email1: 'f0000000-0000-4000-8000-00000000e711',
  email2: 'f0000000-0000-4000-8000-00000000e712',
  interestedReply: 'f0000000-0000-4000-8000-00000000e713',
  neutralReply: 'f0000000-0000-4000-8000-00000000e714',
  breakup: 'f0000000-0000-4000-8000-00000000e715',
} as const;

const CATEGORIZER_FLOW_NODE_ID = 'aiCategorizer-1';

type CampaignKind = 'manual' | 'ai';
type SeedCaseKey =
  | 'interested'
  | 'neutral'
  | 'not_interested'
  | 'ooo_dated'
  | 'ooo_no_date'
  | 'wrong_contact'
  | 'ai_interested'
  | 'pending'
  | 'closed';

type LiveClassification = {
  category: 'Interested' | 'Neutral' | 'Not Interested' | 'Auto Reply';
  returnDate: string | null;
};

type SeedCaseSpec = {
  key: SeedCaseKey;
  subjectTag: string;
  campaignKind: CampaignKind;
  leadFirstName: string;
  leadLastName: string;
  company: string;
  liveCapable: boolean;
};

type SeedCaseState = SeedCaseSpec & {
  leadId: string;
  leadEmail: string;
  leadName: string;
  mailboxId: string;
  mailboxEmail: string;
  enrollmentId: string;
  sentJobId: string;
  queuedJobId: string;
  sentProviderMessageId: string;
  sentAt: string;
  replyAt: string;
  threadId: string | null;
};

type CampaignState = {
  kind: CampaignKind;
  campaignId: string;
  accountId: string;
  ownerUserId: string;
  bucketId: string;
  mailboxId: string;
  mailboxEmail: string;
  nodeIdsByFlowNodeId: Map<string, string>;
  cases: SeedCaseState[];
};

const CASES: SeedCaseSpec[] = [
  {
    key: 'interested',
    subjectTag: '[SH INTERESTED]',
    campaignKind: 'manual',
    leadFirstName: 'Sarah',
    leadLastName: 'Holloway',
    company: 'Brightline Manufacturing',
    liveCapable: true,
  },
  {
    key: 'neutral',
    subjectTag: '[SH NEUTRAL]',
    campaignKind: 'manual',
    leadFirstName: 'Marcus',
    leadLastName: 'Trent',
    company: 'Coldwater Logistics',
    liveCapable: true,
  },
  {
    key: 'not_interested',
    subjectTag: '[SH NOT INTERESTED]',
    campaignKind: 'manual',
    leadFirstName: 'Dana',
    leadLastName: 'Whitfield',
    company: 'Ironvale Supply',
    liveCapable: true,
  },
  {
    key: 'ooo_dated',
    subjectTag: '[SH OOO DATED]',
    campaignKind: 'manual',
    leadFirstName: 'Priya',
    leadLastName: 'Raman',
    company: 'Meridian Freight',
    liveCapable: true,
  },
  {
    key: 'ooo_no_date',
    subjectTag: '[SH OOO NO DATE]',
    campaignKind: 'manual',
    leadFirstName: 'Tomas',
    leadLastName: 'Eriksen',
    company: 'Northgate Partners',
    liveCapable: true,
  },
  {
    key: 'wrong_contact',
    subjectTag: '[SH WRONG CONTACT]',
    campaignKind: 'manual',
    leadFirstName: 'Elena',
    leadLastName: 'Vasquez',
    company: 'Stonebridge Analytics',
    liveCapable: true,
  },
  {
    key: 'pending',
    subjectTag: '[SH PENDING]',
    campaignKind: 'manual',
    leadFirstName: 'Noah',
    leadLastName: 'Mercer',
    company: 'Westward Components',
    liveCapable: false,
  },
  {
    key: 'closed',
    subjectTag: '[SH CLOSED]',
    campaignKind: 'manual',
    leadFirstName: 'Avery',
    leadLastName: 'Collins',
    company: 'Harborline Systems',
    liveCapable: false,
  },
  {
    key: 'ai_interested',
    subjectTag: '[SH AI INTERESTED]',
    campaignKind: 'ai',
    leadFirstName: 'Jordan',
    leadLastName: 'Frost',
    company: 'Northstar Medical',
    liveCapable: true,
  },
];

const store: {
  accountId: string;
  ownerUserId: string;
  returnDateIso: string;
  returnDateHuman: string;
  liveMode: boolean;
  campaigns: Record<CampaignKind, CampaignState>;
} = {
  accountId: '',
  ownerUserId: '',
  returnDateIso: '',
  returnDateHuman: '',
  liveMode: false,
  campaigns: {} as Record<CampaignKind, CampaignState>,
};

function resetStore() {
  store.accountId = '';
  store.ownerUserId = '';
  store.returnDateIso = '';
  store.returnDateHuman = '';
  store.liveMode = false;
  store.campaigns = {} as Record<CampaignKind, CampaignState>;
}

function buildFlowData(useAi: boolean): Json {
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: useAi ? 'Smart Handling AI Source' : 'Smart Handling Manual Source' },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'Initial Touch',
          send_mode: 'new',
          variants: [
            {
              id: VARIANT_IDS.email1,
              label: 'Smart Handling Opener',
              subject: 'Quick question about {{company_name}}, {{first_name}}',
              template:
                'Hi {{first_name}} - quick smart-handling seed check-in about {{company_name}}. Worth a short call?',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'waitTime-1',
        type: 'waitTime',
        position: { x: 460, y: 0 },
        data: { label: 'Brief Wait', wait_duration_seconds: 0 },
      },
      {
        id: 'email-2',
        type: 'email',
        position: { x: 700, y: 0 },
        data: {
          label: 'Follow-up',
          send_mode: 'new',
          variants: [
            {
              id: VARIANT_IDS.email2,
              label: 'Smart Handling Follow-up',
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
          label: useAi ? 'AI Categorizer' : 'Manual Categorizer',
          use_ai: useAi,
        },
      },
      {
        id: 'email-3',
        type: 'email',
        position: { x: 1180, y: -160 },
        data: {
          label: 'Interested Reply',
          send_mode: 'reply',
          variants: [
            {
              id: VARIANT_IDS.interestedReply,
              label: 'Interested Reply',
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
          send_mode: 'reply',
          variants: [
            {
              id: VARIANT_IDS.neutralReply,
              label: 'Neutral Reply',
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
          send_mode: 'new',
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
      { id: 'e2', source: 'email-1', target: 'waitTime-1' },
      { id: 'e3', source: 'waitTime-1', target: 'email-2' },
      { id: 'e4', source: 'email-2', target: CATEGORIZER_FLOW_NODE_ID },
      { id: 'e5', source: CATEGORIZER_FLOW_NODE_ID, sourceHandle: 'interested', target: 'email-3' },
      { id: 'e6', source: CATEGORIZER_FLOW_NODE_ID, sourceHandle: 'neutral', target: 'email-4' },
      { id: 'e7', source: CATEGORIZER_FLOW_NODE_ID, sourceHandle: 'not-interested', target: 'email-5' },
    ],
  } as unknown as Json;
}

function caseSubject(seedCase: SeedCaseSpec): string {
  return `${seedCase.subjectTag} Quick question about ${seedCase.company}, ${seedCase.leadFirstName}`;
}

function buildLeadEmail(campaignId: string, seedCase: SeedCaseSpec): string {
  return `smart-handling-${seedCase.key.replace(/_/g, '-')}-${campaignId.slice(0, 8)}@furnace.test`;
}

function buildWrongContactEmail(campaignId: string): string {
  return `smart-handling-referral-${campaignId.slice(0, 8)}@furnace.test`;
}

function getCampaignConfig(kind: CampaignKind): { campaignId: string; name: string; useAi: boolean } {
  if (kind === 'ai') {
    return {
      campaignId:
        process.env.SEED_SMART_HANDLING_AI_CAMPAIGN_ID?.trim() ||
        DEFAULT_SEED_SMART_HANDLING_AI_CAMPAIGN_ID,
      name: 'Smart Handling AI Seed',
      useAi: true,
    };
  }

  return {
    campaignId:
      process.env.SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID,
    name: 'Smart Handling Manual Seed',
    useAi: false,
  };
}

async function pollNodeId(ctx: SeedContext, campaignId: string, flowNodeId: string): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < NODE_SYNC_TIMEOUT_MS) {
    const { data, error } = await ctx.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('flow_node_id', flowNodeId)
      .maybeSingle();
    if (error) {
      throw new Error(`smart-handling-flow: node poll failed for ${flowNodeId}: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await new Promise((resolve) => setTimeout(resolve, NODE_SYNC_POLL_MS));
  }

  throw new Error(`smart-handling-flow: timed out waiting for node sync (${flowNodeId})`);
}

async function cleanupCampaignSlice(ctx: SeedContext, campaignId: string) {
  const { supabase } = ctx;
  const { data: threadRows, error: threadErr } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', campaignId);
  if (threadErr) {
    throw new Error(`smart-handling-flow: thread lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threadRows ?? []).map((row: any) => row.id as string);
  if (threadIds.length > 0) {
    const { error: msgErr } = await supabase
      .from('email_messages')
      .delete()
      .in('thread_id', threadIds);
    if (msgErr) {
      throw new Error(`smart-handling-flow: email_messages cleanup failed: ${msgErr.message}`);
    }
  }

  const cleanupTables: Array<{ table: string; column: string }> = [
    { table: 'email_threads', column: 'campaign_id' },
    { table: 'message_jobs', column: 'campaign_id' },
    { table: 'enrollments', column: 'campaign_id' },
    { table: 'lead_replacements', column: 'campaign_id' },
    { table: 'leads', column: 'campaign_id' },
    { table: 'campaign_mailboxes', column: 'campaign_id' },
    { table: 'campaign_intervals', column: 'campaign_id' },
    { table: 'events', column: 'campaign_id' },
    { table: 'campaign_stats', column: 'campaign_id' },
  ];

  for (const entry of cleanupTables) {
    const { error } = await supabase.from(entry.table).delete().eq(entry.column, campaignId);
    if (error) {
      throw new Error(`smart-handling-flow: ${entry.table} cleanup failed: ${error.message}`);
    }
  }
}

async function ensureMailbox(
  ctx: SeedContext,
  kind: CampaignKind,
  campaignId: string,
): Promise<{ id: string; email: string }> {
  const email = `${smartHandlingMailboxLocalPart(kind, campaignId)}@furnace.test`;
  const now = new Date().toISOString();

  const { data: found, error: findErr } = await ctx.supabase
    .from('mailboxes')
    .select('id')
    .eq('email_address', email)
    .maybeSingle();
  if (findErr) {
    throw new Error(`smart-handling-flow: mailbox lookup failed: ${findErr.message}`);
  }

  const patch = {
    account_id: store.accountId,
    user_id: store.ownerUserId,
    display_name: kind === 'ai' ? 'Smart Handling AI Seed' : 'Smart Handling Manual Seed',
    status: 'connected',
    smtp_status: 'active',
    deleted_at: null,
    updated_at: now,
  };

  if (found?.id) {
    const { error: updateError } = await ctx.supabase.from('mailboxes').update(patch).eq('id', found.id);
    if (updateError) {
      throw new Error(`smart-handling-flow: mailbox update failed: ${updateError.message}`);
    }
    return { id: found.id as string, email };
  }

  const { data: inserted, error: insertError } = await ctx.supabase
    .from('mailboxes')
    .insert({
      ...patch,
      email_address: email,
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
      created_at: now,
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`smart-handling-flow: mailbox insert failed: ${insertError?.message}`);
  }
  return { id: inserted.id as string, email };
}

async function ensureCampaign(ctx: SeedContext, kind: CampaignKind): Promise<CampaignState> {
  const { campaignId, name, useAi } = getCampaignConfig(kind);
  const { supabase } = ctx;
  const now = new Date().toISOString();
  const flowData = buildFlowData(useAi);
  const schedule = smokeSchedule();

  const { data: existing, error: selectError } = await supabase
    .from('campaigns')
    .select('id, bucket_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (selectError) {
    throw new Error(`smart-handling-flow: campaign lookup failed (${kind}): ${selectError.message}`);
  }

  let bucketId = (existing?.bucket_id as string | null) ?? '';
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        name: `${name} (${campaignId.slice(0, 8)})`,
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
      .eq('id', campaignId);
    if (updateError) {
      throw new Error(`smart-handling-flow: campaign update failed (${kind}): ${updateError.message}`);
    }
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('campaigns')
      .insert({
        id: campaignId,
        name: `${name} (${campaignId.slice(0, 8)})`,
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
    if (insertError || !inserted) {
      throw new Error(`smart-handling-flow: campaign insert failed (${kind}): ${insertError?.message}`);
    }
    bucketId = inserted.bucket_id as string;
  }

  if (!bucketId) {
    const { data: row, error: bucketError } = await supabase
      .from('campaigns')
      .select('bucket_id')
      .eq('id', campaignId)
      .single();
    if (bucketError || !row?.bucket_id) {
      throw new Error(`smart-handling-flow: missing bucket_id (${kind}): ${bucketError?.message}`);
    }
    bucketId = row.bucket_id as string;
  }

  await cleanupCampaignSlice(ctx, campaignId);

  const mailbox = await ensureMailbox(ctx, kind, campaignId);
  const { error: linkError } = await supabase.from('campaign_mailboxes').insert({
    campaign_id: campaignId,
    mailbox_id: mailbox.id,
    account_id: store.accountId,
  });
  if (linkError) {
    throw new Error(`smart-handling-flow: campaign_mailboxes insert failed (${kind}): ${linkError.message}`);
  }

  const nodeIdsByFlowNodeId = new Map<string, string>();
  for (const flowNodeId of [
    'email-1',
    'waitTime-1',
    'email-2',
    CATEGORIZER_FLOW_NODE_ID,
    'email-3',
    'email-4',
    'email-5',
  ]) {
    nodeIdsByFlowNodeId.set(flowNodeId, await pollNodeId(ctx, campaignId, flowNodeId));
  }

  return {
    kind,
    campaignId,
    accountId: store.accountId,
    ownerUserId: store.ownerUserId,
    bucketId,
    mailboxId: mailbox.id,
    mailboxEmail: mailbox.email,
    nodeIdsByFlowNodeId,
    cases: [],
  };
}

function getDeterministicSeedPayload(
  seedCase: SeedCaseState,
): {
  conversationStatus: 'open' | 'closed';
  classificationStatus: 'pending' | 'complete' | 'failed';
  category: string | null;
  categorySource: string | null;
  handlingMetadata: Record<string, unknown> | null;
  fromEmail: string;
  bodyText: string;
} {
  switch (seedCase.key) {
    case 'interested':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedInterestedMetadata() as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'This looks relevant to our team. Can you send over pricing and a couple of times to talk?',
      };
    case 'neutral':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedNeutralMetadata() as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'Thanks for reaching out. Can you share a bit more detail? Timing is unclear on our side.',
      };
    case 'not_interested':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedNotInterestedMetadata({
          bodyText: 'Not interested right now. Please remove me from your list.',
        }) as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'Not interested right now. Please remove me from your list.',
      };
    case 'ooo_dated':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedOooDatedMetadata(store.returnDateIso) as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: `I am out of the office until ${store.returnDateHuman} with limited access to email.`,
      };
    case 'ooo_no_date':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedOooNoDateMetadata() as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'I am currently out of office with no access to email.',
      };
    case 'wrong_contact': {
      const referralEmail = buildWrongContactEmail(store.campaigns.manual.campaignId);
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedWrongContactMetadata(referralEmail) as Record<string, unknown>,
        fromEmail: referralEmail,
        bodyText: `You should speak with ${referralEmail} about this. They own this project on our side.`,
      };
    }
    case 'pending':
      return {
        conversationStatus: 'open',
        classificationStatus: 'pending',
        category: null,
        categorySource: null,
        handlingMetadata: null,
        fromEmail: seedCase.leadEmail,
        bodyText: 'Can you send over more detail when you have a minute?',
      };
    case 'closed':
      return {
        conversationStatus: 'closed',
        classificationStatus: 'complete',
        category: null,
        categorySource: null,
        handlingMetadata: buildSeedInterestedMetadata() as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'This looks interesting, but I already handled it.',
      };
    case 'ai_interested':
      return {
        conversationStatus: 'open',
        classificationStatus: 'complete',
        category: 'Interested',
        categorySource: 'ai',
        handlingMetadata: buildSeedAiMetadata('Interested') as Record<string, unknown>,
        fromEmail: seedCase.leadEmail,
        bodyText: 'This is relevant - please send pricing details.',
      };
  }
}

function getLiveClassification(seedCase: SeedCaseState): LiveClassification {
  switch (seedCase.key) {
    case 'interested':
      return { category: 'Interested', returnDate: null };
    case 'neutral':
      return { category: 'Neutral', returnDate: null };
    case 'not_interested':
      return { category: 'Not Interested', returnDate: null };
    case 'ooo_dated':
      return { category: 'Auto Reply', returnDate: store.returnDateIso };
    case 'ooo_no_date':
      return { category: 'Auto Reply', returnDate: null };
    case 'wrong_contact':
      return { category: 'Interested', returnDate: null };
    case 'ai_interested':
      return { category: 'Interested', returnDate: null };
    default:
      throw new Error(`smart-handling-flow: case ${seedCase.key} does not support live classify`);
  }
}

function buildLiveReply(seedCase: SeedCaseState): { fromEmail: string; bodyText: string } {
  switch (seedCase.key) {
    case 'interested':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText:
          'This looks very relevant to what we are working on this quarter. Can you send over pricing and a couple of times to talk this week?',
      };
    case 'neutral':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText:
          'Thanks for reaching out. Can you share more details on how this works? We might look at this next quarter.',
      };
    case 'not_interested':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText: 'Not interested, please remove me from your list. We already have a vendor for this.',
      };
    case 'ooo_dated':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText: `Thank you for your email. I am out of the office until ${store.returnDateHuman} with limited access to email.`,
      };
    case 'ooo_no_date':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText: 'I am currently out of the office with no access to email. I will respond once I return.',
      };
    case 'wrong_contact': {
      const fromEmail = buildWrongContactEmail(store.campaigns.manual.campaignId);
      return {
        fromEmail,
        bodyText: `You should talk to ${fromEmail} on our team. They own this evaluation from here.`,
      };
    }
    case 'ai_interested':
      return {
        fromEmail: seedCase.leadEmail,
        bodyText: 'This looks great. Please send pricing and a couple of times to connect this week.',
      };
    default:
      throw new Error(`smart-handling-flow: case ${seedCase.key} does not support live replies`);
  }
}

function buildProcessedReplyMessage(params: {
  fromEmail: string;
  fromName: string;
  mailboxEmail: string;
  subject: string;
  bodyText: string;
  inReplyTo: string;
  receivedAt: string;
}): ProcessedMessage {
  return {
    uid: Math.floor(Math.random() * 1_000_000),
    messageId: `<seed-smart-handling-reply-${randomUUID()}@furnace.test>`,
    inReplyTo: params.inReplyTo,
    references: params.inReplyTo,
    from: { address: params.fromEmail, name: params.fromName },
    to: [{ address: params.mailboxEmail, name: 'Smart Handling Seed' }],
    subject: `Re: ${params.subject}`,
    bodyText: params.bodyText,
    bodyHtml: `<p>${params.bodyText}</p>`,
    date: new Date(params.receivedAt),
    headers: {},
    attachments: [],
  };
}

function makeSqsEvent(payload: Record<string, unknown>) {
  return {
    Records: [
      {
        messageId: `seed-${randomUUID()}`,
        receiptHandle: 'seed-receipt',
        body: JSON.stringify(payload),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: `${Date.now()}`,
          SenderId: 'seed',
          ApproximateFirstReceiveTimestamp: `${Date.now()}`,
        },
        messageAttributes: {},
        md5OfBody: 'seed-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:seed-smart-handling',
        awsRegion: 'us-west-2',
      },
    ],
  };
}

async function withMockedCategorizerFetch(
  classification: LiveClassification,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('openrouter.ai')) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: classification.category,
                  return_date: classification.returnDate,
                }),
              },
            },
          ],
        }),
      } as Response;
    }
    return originalFetch(input as any, init);
  }) as typeof fetch;

  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }
}

async function loadMailbox(ctx: SeedContext, mailboxId: string): Promise<Mailbox> {
  const { data, error } = await ctx.supabase
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single();
  if (error || !data) {
    throw new Error(`smart-handling-flow: failed to load mailbox ${mailboxId}: ${error?.message}`);
  }
  return data as Mailbox;
}

async function findThreadBySentJob(ctx: SeedContext, sentJobId: string): Promise<{ id: string }> {
  const { data, error } = await ctx.supabase
    .from('email_threads')
    .select('id')
    .eq('message_job_id', sentJobId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`smart-handling-flow: failed to locate thread for sent job ${sentJobId}: ${error?.message}`);
  }
  return { id: data.id as string };
}

async function findLatestReceivedMessageId(ctx: SeedContext, threadId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('email_messages')
    .select('id')
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(1);
  if (error || !data?.[0]?.id) {
    throw new Error(`smart-handling-flow: failed to find received message for thread ${threadId}: ${error?.message}`);
  }
  return data[0].id as string;
}

async function seedDeterministicThread(ctx: SeedContext, seedCase: SeedCaseState) {
  const payload = getDeterministicSeedPayload(seedCase);
  const now = new Date().toISOString();
  const { data: thread, error: threadError } = await ctx.supabase
    .from('email_threads')
    .insert({
      account_id: store.accountId,
      campaign_id: seedCase.campaignKind === 'ai' ? store.campaigns.ai.campaignId : store.campaigns.manual.campaignId,
      lead_id: seedCase.leadId,
      enrollment_id: seedCase.enrollmentId,
      message_job_id: seedCase.sentJobId,
      mailbox_id: seedCase.mailboxId,
      subject: caseSubject(seedCase),
      participants: [seedCase.mailboxEmail, payload.fromEmail],
      last_message_at: seedCase.replyAt,
      message_count: 2,
      has_reply: true,
      category: payload.category,
      category_source: payload.categorySource,
      conversation_status: payload.conversationStatus,
      conversation_status_source: 'system',
      classification_status: payload.classificationStatus,
      classification_requested_at: seedCase.replyAt,
      classification_completed_at:
        payload.classificationStatus === 'complete' || payload.classificationStatus === 'failed'
          ? now
          : null,
      handling_metadata: payload.handlingMetadata as Json | null,
      created_at: seedCase.sentAt,
      updated_at: seedCase.replyAt,
    })
    .select('id')
    .single();
  if (threadError || !thread?.id) {
    throw new Error(`smart-handling-flow: thread insert failed (${seedCase.key}): ${threadError?.message}`);
  }
  seedCase.threadId = thread.id as string;

  const { error: messagesError } = await ctx.supabase.from('email_messages').insert([
    {
      thread_id: seedCase.threadId,
      account_id: store.accountId,
      message_job_id: seedCase.sentJobId,
      direction: 'sent',
      from_email: seedCase.mailboxEmail,
      from_name: 'Smart Handling Seed',
      to_email: seedCase.leadEmail,
      to_name: seedCase.leadName,
      subject: caseSubject(seedCase),
      body_text: `Hi ${seedCase.leadFirstName} - quick smart-handling seed check-in about ${seedCase.company}. Worth a short call?`,
      body_html: null,
      message_id: seedCase.sentProviderMessageId,
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
      from_email: payload.fromEmail,
      from_name:
        seedCase.key === 'wrong_contact' ? 'Alternate Contact' : `${seedCase.leadFirstName} ${seedCase.leadLastName}`,
      to_email: seedCase.mailboxEmail,
      to_name: 'Smart Handling Seed',
      subject: `Re: ${caseSubject(seedCase)}`,
      body_text: payload.bodyText,
      body_html: null,
      message_id: `<seed-smart-handling-${seedCase.key}-${randomUUID()}@furnace.test>`,
      in_reply_to: seedCase.sentProviderMessageId,
      message_references: seedCase.sentProviderMessageId,
      received_at: seedCase.replyAt,
      read_at: seedCase.key === 'closed' ? seedCase.replyAt : null,
      headers: {},
      attachments: [],
      created_at: seedCase.replyAt,
      updated_at: seedCase.replyAt,
    },
  ]);
  if (messagesError) {
    throw new Error(`smart-handling-flow: email_messages insert failed (${seedCase.key}): ${messagesError.message}`);
  }
}

async function seedLiveReply(ctx: SeedContext, seedCase: SeedCaseState) {
  const mailbox = await loadMailbox(ctx, seedCase.mailboxId);
  const liveReply = buildLiveReply(seedCase);
  const threadManager = new ThreadManager(ctx.supabase as any);
  const processedMessage = buildProcessedReplyMessage({
    fromEmail: liveReply.fromEmail,
    fromName:
      seedCase.key === 'wrong_contact' ? 'Alternate Contact' : `${seedCase.leadFirstName} ${seedCase.leadLastName}`,
    mailboxEmail: seedCase.mailboxEmail,
    subject: caseSubject(seedCase),
    bodyText: liveReply.bodyText,
    inReplyTo: seedCase.sentProviderMessageId,
    receivedAt: seedCase.replyAt,
  });

  const handled = await threadManager.handleReply(mailbox, processedMessage);
  if (!handled) {
    throw new Error(`smart-handling-flow: ThreadManager rejected reply for ${seedCase.key}`);
  }

  const thread = await findThreadBySentJob(ctx, seedCase.sentJobId);
  seedCase.threadId = thread.id;
  const emailMessageId = await findLatestReceivedMessageId(ctx, thread.id);
  const classification = getLiveClassification(seedCase);

  process.env.SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';

  await withMockedCategorizerFetch(classification, async () => {
    const response = await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: seedCase.threadId,
        enrollmentId: seedCase.enrollmentId,
        campaignId:
          seedCase.campaignKind === 'ai'
            ? store.campaigns.ai.campaignId
            : store.campaigns.manual.campaignId,
        hasCategorizer: true,
        useAi: seedCase.campaignKind === 'ai',
      }) as any,
    );
    if (response.batchItemFailures.length > 0) {
      throw new Error(`smart-handling-flow: classify handler failed for ${seedCase.key}`);
    }
  });
}

export const smartHandlingFlowEnvModule: SeedModule = {
  id: 'smartHandlingFlow_env',
  description: 'Validate env and initialize smart-handling flow store',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'smart-handling-flow requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).',
      );
    }

    resetStore();
    store.accountId = accountId;
    store.ownerUserId = ownerUserId;
    store.liveMode = process.env.SEED_SMART_HANDLING_LIVE === '1';

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
        `[dry-run] would use accountId=${accountId} ownerUserId=${ownerUserId} manualCampaign=${getCampaignConfig('manual').campaignId} aiCampaign=${getCampaignConfig('ai').campaignId} liveMode=${store.liveMode}`,
      );
    }
  },
};

export const smartHandlingFlowBaseGraphModule: SeedModule = {
  id: 'smartHandlingFlow_baseGraph',
  description: 'Create campaign/mailbox/leads/enrollments/jobs for the smart-handling inbox flow',
  deps: ['smartHandlingFlow_env'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log('[dry-run] would create smart-handling-flow campaigns, mailboxes, leads, enrollments, and jobs');
      return;
    }

    store.campaigns.manual = await ensureCampaign(ctx, 'manual');
    store.campaigns.ai = await ensureCampaign(ctx, 'ai');

    const baseTime = Date.now() - 6 * 60 * 60 * 1000;
    let order = 0;
    for (const spec of CASES) {
      const campaign = store.campaigns[spec.campaignKind];
      const leadEmail = buildLeadEmail(campaign.campaignId, spec);
      const leadName = `${spec.leadFirstName} ${spec.leadLastName}`;
      const nextRunAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const sentAt = new Date(baseTime + order * 10 * 60 * 1000).toISOString();
      const replyAt = new Date(Date.parse(sentAt) + 25 * 60 * 1000).toISOString();
      const messageData = {
        node_config: {},
        lead_data: {
          email: leadEmail,
          name: leadName,
          first_name: spec.leadFirstName,
          last_name: spec.leadLastName,
          company_name: spec.company,
        },
      };

      const { data: lead, error: leadError } = await ctx.supabase
        .from('leads')
        .insert({
          campaign_id: campaign.campaignId,
          bucket_id: campaign.bucketId,
          account_id: campaign.accountId,
          email: leadEmail,
          name: leadName,
          first_name: spec.leadFirstName,
          last_name: spec.leadLastName,
          company_name: spec.company,
          source: SEED_SOURCE,
          mailbox_id: campaign.mailboxId,
        })
        .select('id')
        .single();
      if (leadError || !lead) {
        throw new Error(`smart-handling-flow: lead insert failed (${spec.key}): ${leadError?.message}`);
      }

      const { data: enrollment, error: enrollmentError } = await ctx.supabase
        .from('enrollments')
        .insert({
          campaign_id: campaign.campaignId,
          account_id: campaign.accountId,
          lead_id: lead.id,
          current_node_id: campaign.nodeIdsByFlowNodeId.get('email-2'),
          state: 'active',
          next_run_at: nextRunAt,
          flow_position: {},
        })
        .select('id')
        .single();
      if (enrollmentError || !enrollment) {
        throw new Error(
          `smart-handling-flow: enrollment insert failed (${spec.key}): ${enrollmentError?.message}`,
        );
      }

      const sentProviderMessageId = `<seed-smart-handling-${spec.key}-sent@furnace.test>`;
      const { data: sentJob, error: sentJobError } = await ctx.supabase
        .from('message_jobs')
        .insert({
          enrollment_id: enrollment.id,
          campaign_id: campaign.campaignId,
          account_id: campaign.accountId,
          lead_id: lead.id,
          mailbox_id: campaign.mailboxId,
          node_id: campaign.nodeIdsByFlowNodeId.get('email-1'),
          status: 'sent',
          status_reason: 'sent_successfully',
          scheduled_at: sentAt,
          sent_at: sentAt,
          provider_message_id: sentProviderMessageId,
          message_data: messageData,
          message_type: 'campaign',
        })
        .select('id')
        .single();
      if (sentJobError || !sentJob) {
        throw new Error(`smart-handling-flow: sent job insert failed (${spec.key}): ${sentJobError?.message}`);
      }

      const { data: queuedJob, error: queuedJobError } = await ctx.supabase
        .from('message_jobs')
        .insert({
          enrollment_id: enrollment.id,
          campaign_id: campaign.campaignId,
          account_id: campaign.accountId,
          lead_id: lead.id,
          mailbox_id: campaign.mailboxId,
          node_id: campaign.nodeIdsByFlowNodeId.get('email-2'),
          status: 'queued',
          scheduled_at: nextRunAt,
          message_data: messageData,
          message_type: 'campaign',
        })
        .select('id')
        .single();
      if (queuedJobError || !queuedJob) {
        throw new Error(
          `smart-handling-flow: queued job insert failed (${spec.key}): ${queuedJobError?.message}`,
        );
      }

      campaign.cases.push({
        ...spec,
        leadId: lead.id as string,
        leadEmail,
        leadName,
        mailboxId: campaign.mailboxId,
        mailboxEmail: campaign.mailboxEmail,
        enrollmentId: enrollment.id as string,
        sentJobId: sentJob.id as string,
        queuedJobId: queuedJob.id as string,
        sentProviderMessageId,
        sentAt,
        replyAt,
        threadId: null,
      });
      order += 1;
    }

    ctx.log(
      `smart-handling-flow graph ready manualCases=${store.campaigns.manual.cases.length} aiCases=${store.campaigns.ai.cases.length} liveMode=${store.liveMode}`,
    );
  },
};

export const smartHandlingFlowThreadsModule: SeedModule = {
  id: 'smartHandlingFlow_threads',
  description: 'Insert deterministic inbox threads that render Smart Handling states immediately',
  deps: ['smartHandlingFlow_baseGraph'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log('[dry-run] would insert deterministic Smart Handling threads/messages');
      return;
    }

    const allCases = [...store.campaigns.manual.cases, ...store.campaigns.ai.cases];
    for (const seedCase of allCases) {
      if (store.liveMode && seedCase.liveCapable) {
        continue;
      }
      await seedDeterministicThread(ctx, seedCase);
    }

    ctx.log(
      `smart-handling-flow deterministic threads seeded count=${allCases.filter((seedCase) => !(store.liveMode && seedCase.liveCapable)).length}`,
    );
  },
};

export const smartHandlingFlowLiveRepliesModule: SeedModule = {
  id: 'smartHandlingFlow_liveReplies',
  description: 'Optionally drive selected cases through the inbox-checker and classify lambda code paths',
  deps: ['smartHandlingFlow_threads'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log('[dry-run] would optionally route selected Smart Handling cases through ThreadManager + classifyReply');
      return;
    }

    if (!store.liveMode) {
      ctx.log('smart-handling-flow live mode disabled; deterministic Smart Handling dataset is ready');
      return;
    }

    const liveCases = [...store.campaigns.manual.cases, ...store.campaigns.ai.cases].filter(
      (seedCase) => seedCase.liveCapable,
    );
    for (const seedCase of liveCases) {
      await seedLiveReply(ctx, seedCase);
    }

    ctx.log(`smart-handling-flow live replies processed count=${liveCases.length}`);
  },
};
