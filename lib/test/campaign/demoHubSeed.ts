import type {
  CampaignGraphSpec,
  CampaignLeadSpec,
  CampaignLeadReplacementSpec,
  CampaignMailboxSpec,
  CampaignStatus,
} from './harness';
import {
  DEMO_ACCOUNT_NAME,
  DEMO_HERO_THREAD_KEYS,
  demoCampaignName,
  demoLeadPersona,
  demoMailboxDisplayName,
  demoOutboundBody,
  demoReplyBody,
  demoThreadSubject,
  DEMO_HERO_THREAD_KEYS,
} from '../../../scripts/seed/theme/demoCopy';

export { DEMO_HERO_THREAD_KEYS };

export const DEMO_HUB_NAMESPACE = 'demo-hub';
export const DEMO_HUB_EMAIL_DOMAIN = 'demo.furnace.test';
export const DEMO_HUB_TOTAL_LEADS = 3_000;
export const DEMO_HUB_CONVERSATION_COUNT = 40;
export const DEMO_HUB_MAILBOX_COUNT = 30;
export const DEMO_HUB_REPLY_RATE = 0.03;
export const DEMO_HUB_POSITIVE_SHARE_OF_REPLIES = 0.3;

export const DEMO_HUB_CAMPAIGN_IDS = [
  'f0000000-0000-4000-8000-00000000d001',
  'f0000000-0000-4000-8000-00000000d002',
  'f0000000-0000-4000-8000-00000000d003',
  'f0000000-0000-4000-8000-00000000d004',
] as const;

export type DemoHubCampaignStatTarget = {
  campaignId: string;
  targetSent: number;
  replyRate?: number;
  positiveShareOfReplies?: number;
};

export const DEMO_HUB_CAMPAIGN_STAT_TARGETS: DemoHubCampaignStatTarget[] = [
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[0],
    targetSent: 1_800,
    replyRate: DEMO_HUB_REPLY_RATE,
    positiveShareOfReplies: DEMO_HUB_POSITIVE_SHARE_OF_REPLIES,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[1],
    targetSent: 600,
    replyRate: DEMO_HUB_REPLY_RATE,
    positiveShareOfReplies: DEMO_HUB_POSITIVE_SHARE_OF_REPLIES,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[2],
    targetSent: 350,
    replyRate: DEMO_HUB_REPLY_RATE,
    positiveShareOfReplies: DEMO_HUB_POSITIVE_SHARE_OF_REPLIES,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[3],
    targetSent: 0,
  },
];

export type DerivedCampaignStats = {
  sent: number;
  replied: number;
  positive: number;
  replyRate: number;
  positiveShareOfReplies: number;
};

export function deriveCampaignStatsFromSent(
  targetSent: number,
  replyRate = DEMO_HUB_REPLY_RATE,
  positiveShareOfReplies = DEMO_HUB_POSITIVE_SHARE_OF_REPLIES,
): DerivedCampaignStats {
  const replied = Math.round(targetSent * replyRate);
  const positive = Math.round(replied * positiveShareOfReplies);
  return {
    sent: targetSent,
    replied,
    positive,
    replyRate: targetSent > 0 ? replied / targetSent : 0,
    positiveShareOfReplies: replied > 0 ? positive / replied : 0,
  };
}

export const DEMO_HUB_MAILBOX_SPECS: CampaignMailboxSpec[] = Array.from(
  { length: DEMO_HUB_MAILBOX_COUNT },
  (_, idx) => ({
    key: `mailbox-${idx + 1}`,
    emailAddress: `${DEMO_HUB_NAMESPACE}-mb-${idx + 1}@${DEMO_HUB_EMAIL_DOMAIN}`,
    displayName: demoMailboxDisplayName(idx),
  }),
);

type CampaignPreset = {
  campaignId: string;
  key: string;
  name: string;
  status: CampaignStatus;
  flowKind: 'emailOnly' | 'emailWaitEmail';
  leadCount: number;
  threadCount: number;
};

const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[0],
    key: 'running-primary',
    name: demoCampaignName(0),
    status: 'running',
    flowKind: 'emailWaitEmail',
    leadCount: 1_400,
    threadCount: 28,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[1],
    key: 'paused',
    name: demoCampaignName(1),
    status: 'paused',
    flowKind: 'emailOnly',
    leadCount: 900,
    threadCount: 8,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[2],
    key: 'stopped',
    name: demoCampaignName(2),
    status: 'stopped',
    flowKind: 'emailOnly',
    leadCount: 400,
    threadCount: 4,
  },
  {
    campaignId: DEMO_HUB_CAMPAIGN_IDS[3],
    key: 'draft',
    name: demoCampaignName(3),
    status: 'draft',
    flowKind: 'emailOnly',
    leadCount: 300,
    threadCount: 0,
  },
];

function mailboxKeyForIndex(index: number): string {
  return DEMO_HUB_MAILBOX_SPECS[index % DEMO_HUB_MAILBOX_SPECS.length]?.key ?? 'mailbox-1';
}

function leadEmail(campaignKey: string, index: number): string {
  return `${DEMO_HUB_NAMESPACE}-${campaignKey}-lead-${String(index + 1).padStart(4, '0')}@${DEMO_HUB_EMAIL_DOMAIN}`;
}

function buildGenericLead(campaignKey: string, index: number): CampaignLeadSpec {
  const persona = demoLeadPersona(index);
  return {
    key: `${campaignKey}-lead-${index + 1}`,
    email: leadEmail(campaignKey, index),
    firstName: persona.firstName,
    lastName: persona.lastName,
    name: persona.name,
    companyName: persona.companyName,
    mailboxKey: mailboxKeyForIndex(index),
    source: DEMO_HUB_NAMESPACE,
    enrollment: {
      state: 'active',
      currentFlowNodeId: null,
      nextRunAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      flowPosition: {},
    },
    jobs: [],
    thread: null,
  };
}

export const DEMO_HUB_OPEN_THREAD_TARGET = 5;

type DemoReplyTone = 'interested' | 'not_interested' | 'neutral' | 'ooo';

function demoCategoryForThreadIndex(threadIndex: number): { tone: DemoReplyTone; category: string } {
  const slot = threadIndex % 10;
  if (slot <= 3) {
    return { tone: 'interested', category: 'Interested' };
  }
  if (slot <= 7) {
    return { tone: 'not_interested', category: 'Not Interested' };
  }
  return { tone: 'neutral', category: 'Neutral' };
}

function demoConversationStatusForHero(heroKey: string): 'open' | 'closed' {
  switch (heroKey) {
    case DEMO_HERO_THREAD_KEYS.interested:
    case DEMO_HERO_THREAD_KEYS.unread:
    case DEMO_HERO_THREAD_KEYS.multiMessage:
    case DEMO_HERO_THREAD_KEYS.replacedNew:
      return 'open';
    default:
      return 'closed';
  }
}

function isoAt(baseTime: number, offsetMinutes: number): string {
  return new Date(baseTime + offsetMinutes * 60_000).toISOString();
}

function buildSentJob(scheduledAt: string, sentAt?: string) {
  return {
    key: 'sent-job',
    nodeFlowNodeId: 'email-1',
    status: 'sent' as const,
    scheduledAt,
    sentAt: sentAt ?? scheduledAt,
    messageType: 'campaign' as const,
    messageData: { source: DEMO_HUB_NAMESPACE },
  };
}

function buildConversationThread(params: {
  subject: string;
  sentAt: string;
  replyAt: string;
  outboundBody: string;
  replyBody: string;
  category?: string | null;
  categorySource?: string | null;
  conversationStatus?: 'open' | 'closed';
  conversationStatusSource?: 'user' | 'system';
  outOfOffice?: boolean;
  unread?: boolean;
  extraMessages?: Array<{ direction: 'sent' | 'received'; bodyText: string; receivedAt: string; readAt?: string | null }>;
}): CampaignLeadSpec['thread'] {
  const messages = [
    {
      direction: 'sent' as const,
      bodyText: params.outboundBody,
      receivedAt: params.sentAt,
      readAt: params.sentAt,
    },
    {
      direction: 'received' as const,
      bodyText: params.replyBody,
      receivedAt: params.replyAt,
      readAt: params.unread ? null : params.replyAt,
    },
    ...(params.extraMessages ?? []),
  ];

  return {
    key: 'thread',
    subject: params.subject,
    lastMessageAt: messages[messages.length - 1]?.receivedAt ?? params.replyAt,
    outOfOffice: params.outOfOffice ?? false,
    oooResumeRequested: params.outOfOffice ?? false,
    oooResumeAt: params.outOfOffice ? isoAt(Date.parse(params.replyAt), 24 * 60) : null,
    oooResumeProcessedAt: null,
    messageJobKey: 'sent-job',
    category: params.category ?? null,
    categorySource: params.categorySource ?? null,
    conversationStatus: params.conversationStatus ?? 'closed',
    conversationStatusSource: params.conversationStatusSource ?? 'system',
    messages,
  };
}

function buildRunningHeroSlices(): CampaignLeadSpec[] {
  const baseTime = Date.parse('2026-05-10T15:00:00.000Z');

  return [
    {
      key: DEMO_HERO_THREAD_KEYS.interested,
      email: `${DEMO_HUB_NAMESPACE}-hero-interested@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(0),
      mailboxKey: 'mailbox-1',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -120),
      },
      jobs: [buildSentJob(isoAt(baseTime, -240), isoAt(baseTime, -230))],
      thread: buildConversationThread({
        subject: 'Re: quick question about your outbound',
        sentAt: isoAt(baseTime, -230),
        replyAt: isoAt(baseTime, -40),
        outboundBody: demoOutboundBody(0),
        replyBody: demoReplyBody(0, 'interested'),
        category: 'Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.interested),
        unread: true,
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.neutral,
      email: `${DEMO_HUB_NAMESPACE}-hero-neutral@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(1),
      mailboxKey: 'mailbox-2',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -100),
      },
      jobs: [buildSentJob(isoAt(baseTime, -200), isoAt(baseTime, -190))],
      thread: buildConversationThread({
        subject: 'Following up from the webinar',
        sentAt: isoAt(baseTime, -190),
        replyAt: isoAt(baseTime, -60),
        outboundBody: demoOutboundBody(1),
        replyBody: demoReplyBody(1, 'neutral'),
        category: 'Neutral',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.neutral),
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.ooo,
      email: `${DEMO_HUB_NAMESPACE}-hero-ooo@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(2),
      mailboxKey: 'mailbox-3',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -180),
      },
      jobs: [
        buildSentJob(isoAt(baseTime, -300), isoAt(baseTime, -290)),
        {
          key: 'campaign-pending',
          nodeFlowNodeId: 'email-2',
          status: 'queued',
          scheduledAt: isoAt(baseTime, -60),
          messageType: 'campaign',
          messageData: { source: DEMO_HUB_NAMESPACE },
        },
      ],
      thread: buildConversationThread({
        subject: 'Re: timing for a quick call',
        sentAt: isoAt(baseTime, -290),
        replyAt: isoAt(baseTime, -90),
        outboundBody: demoOutboundBody(2),
        replyBody: demoReplyBody(2, 'ooo'),
        category: 'Auto Reply',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.ooo),
        outOfOffice: true,
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.replacedOld,
      email: `${DEMO_HUB_NAMESPACE}-hero-replaced-old@${DEMO_HUB_EMAIL_DOMAIN}`,
      name: 'Jordan Lee',
      firstName: 'Jordan',
      lastName: 'Lee',
      companyName: 'Summit HR Partners',
      mailboxKey: 'mailbox-1',
      source: DEMO_HUB_NAMESPACE,
      deletedAt: isoAt(baseTime, -240),
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -240),
      },
      jobs: [buildSentJob(isoAt(baseTime, -360), isoAt(baseTime, -350))],
      thread: buildConversationThread({
        subject: 'Re: intro from Alex on Sales',
        sentAt: isoAt(baseTime, -350),
        replyAt: isoAt(baseTime, -180),
        outboundBody: demoOutboundBody(3),
        replyBody: 'I am moving on from this role — please contact my teammate instead.',
        category: 'Not Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.replacedOld),
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.replacedNew,
      email: `${DEMO_HUB_NAMESPACE}-hero-replaced-new@${DEMO_HUB_EMAIL_DOMAIN}`,
      name: 'Casey Morgan',
      firstName: 'Casey',
      lastName: 'Morgan',
      companyName: 'Summit HR Partners',
      mailboxKey: 'mailbox-1',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'active',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: isoAt(baseTime, 45),
        flowPosition: {},
      },
      jobs: [
        {
          key: 'pending-follow-up',
          nodeFlowNodeId: 'email-2',
          status: 'queued',
          scheduledAt: isoAt(baseTime, 60),
          messageType: 'campaign',
          messageData: { source: DEMO_HUB_NAMESPACE },
        },
      ],
      thread: buildConversationThread({
        subject: 'Re: intro from Alex on Sales',
        sentAt: isoAt(baseTime, -30),
        replyAt: isoAt(baseTime, -30),
        outboundBody: demoOutboundBody(4),
        replyBody: 'Happy to take this over — send me the details.',
        category: 'Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.replacedNew),
        unread: true,
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.unread,
      email: `${DEMO_HUB_NAMESPACE}-hero-unread@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(5),
      mailboxKey: 'mailbox-4',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: isoAt(baseTime, -15),
        flowPosition: {},
      },
      jobs: [buildSentJob(isoAt(baseTime, -120), isoAt(baseTime, -110))],
      thread: buildConversationThread({
        subject: 'Re: your note on pipeline coverage',
        sentAt: isoAt(baseTime, -110),
        replyAt: isoAt(baseTime, -20),
        outboundBody: demoOutboundBody(5),
        replyBody: demoReplyBody(5, 'interested'),
        category: 'Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.unread),
        unread: true,
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.multiMessage,
      email: `${DEMO_HUB_NAMESPACE}-hero-multi@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(6),
      mailboxKey: 'mailbox-5',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -30),
      },
      jobs: [buildSentJob(isoAt(baseTime, -400), isoAt(baseTime, -390))],
      thread: buildConversationThread({
        subject: 'Re: scheduling a demo',
        sentAt: isoAt(baseTime, -390),
        replyAt: isoAt(baseTime, -180),
        outboundBody: demoOutboundBody(6),
        replyBody: 'Potentially interested — what does onboarding look like?',
        category: 'Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.multiMessage),
        extraMessages: [
          {
            direction: 'sent',
            bodyText: 'Great question — typical onboarding is about two weeks with a dedicated CSM.',
            receivedAt: isoAt(baseTime, -120),
            readAt: isoAt(baseTime, -120),
          },
          {
            direction: 'received',
            bodyText: 'That works. Can we aim for Thursday afternoon?',
            receivedAt: isoAt(baseTime, -30),
            readAt: null,
          },
        ],
      }),
    },
    {
      key: DEMO_HERO_THREAD_KEYS.notInterested,
      email: `${DEMO_HUB_NAMESPACE}-hero-not-interested@${DEMO_HUB_EMAIL_DOMAIN}`,
      ...demoLeadPersona(7),
      mailboxKey: 'mailbox-6',
      source: DEMO_HUB_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: isoAt(baseTime, -70),
      },
      jobs: [buildSentJob(isoAt(baseTime, -160), isoAt(baseTime, -150))],
      thread: buildConversationThread({
        subject: 'Re: pricing overview',
        sentAt: isoAt(baseTime, -150),
        replyAt: isoAt(baseTime, -70),
        outboundBody: demoOutboundBody(7),
        replyBody: demoReplyBody(7, 'not_interested'),
        category: 'Not Interested',
        categorySource: 'system',
        conversationStatus: demoConversationStatusForHero(DEMO_HERO_THREAD_KEYS.notInterested),
      }),
    },
  ];
}

function buildRunningReplacementSpecs(): CampaignLeadReplacementSpec[] {
  return [
    {
      oldKey: DEMO_HERO_THREAD_KEYS.replacedOld,
      newKey: DEMO_HERO_THREAD_KEYS.replacedNew,
      reason: 'manual_referral',
      reasonNote: 'Demo replacement pair for onboarding clip.',
    },
  ];
}

function assignGenericThread(
  lead: CampaignLeadSpec,
  threadIndex: number,
  options?: { open?: boolean },
): void {
  const baseTime = Date.parse('2026-05-11T10:00:00.000Z') + threadIndex * 20 * 60_000;
  const sentAt = new Date(baseTime).toISOString();
  const replyAt = new Date(baseTime + 12 * 60_000).toISOString();
  const { tone, category } = demoCategoryForThreadIndex(threadIndex);

  lead.enrollment = {
    state: 'stopped',
    currentFlowNodeId: 'waitTime-1',
    nextRunAt: null,
    flowPosition: {},
    stoppedReason: 'replied',
    stoppedAt: replyAt,
  };
  lead.jobs = [buildSentJob(sentAt, sentAt)];
  lead.thread = buildConversationThread({
    subject: demoThreadSubject(threadIndex),
    sentAt,
    replyAt,
    outboundBody: demoOutboundBody(threadIndex),
    replyBody: demoReplyBody(threadIndex, tone),
    category,
    categorySource: 'system',
    conversationStatus: options?.open ? 'open' : 'closed',
    unread: threadIndex % 4 === 0,
  });
}

function buildRunningPrimaryLeads(): CampaignLeadSpec[] {
  const preset = CAMPAIGN_PRESETS[0];
  const leads = buildRunningHeroSlices();
  const heroCount = leads.length;

  for (let i = heroCount; i < preset.leadCount; i += 1) {
    const lead = buildGenericLead(preset.key, i);
    const threadSlot = i - heroCount;

    if (threadSlot < preset.threadCount - heroCount) {
      assignGenericThread(lead, threadSlot + heroCount, { open: threadSlot === 0 });
    } else if (i < 400) {
      lead.enrollment = {
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
      lead.jobs = [
        {
          key: 'pending-job',
          nodeFlowNodeId: 'email-1',
          status: i % 2 === 0 ? 'queued' : 'reserved',
          scheduledAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          messageType: 'campaign',
          messageData: { source: DEMO_HUB_NAMESPACE },
        },
      ];
    } else if (i < 1_050) {
      lead.enrollment = {
        state: 'completed',
        currentFlowNodeId: 'email-2',
        nextRunAt: null,
        flowPosition: {},
      };
      lead.jobs = [
        {
          key: 'sent-history',
          nodeFlowNodeId: 'email-2',
          status: 'sent',
          scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 60_000).toISOString(),
          messageType: 'campaign',
          messageData: { source: DEMO_HUB_NAMESPACE },
        },
      ];
    } else if (i < 1_250) {
      lead.enrollment = {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: i % 2 === 0 ? 'replied' : 'bounced',
        stoppedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      };
    }
    leads.push(lead);
  }

  return leads;
}

function buildSecondaryCampaignLeads(preset: CampaignPreset): CampaignLeadSpec[] {
  const leads: CampaignLeadSpec[] = [];

  for (let i = 0; i < preset.leadCount; i += 1) {
    const lead = buildGenericLead(preset.key, i);

    if (i < preset.threadCount) {
      assignGenericThread(lead, i + 100);
    } else if (preset.status === 'paused') {
      lead.enrollment = {
        state: 'paused',
        currentFlowNodeId: 'email-1',
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
      if (i < 120) {
        lead.jobs = [
          {
            key: 'reserved-job',
            nodeFlowNodeId: 'email-1',
            status: 'reserved',
            scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            messageType: 'campaign',
            messageData: { source: DEMO_HUB_NAMESPACE },
          },
        ];
      }
    } else if (preset.status === 'stopped') {
      lead.enrollment = {
        state: i < 120 ? 'completed' : 'stopped',
        currentFlowNodeId: 'email-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: i < 120 ? null : 'error',
        stoppedAt: i < 120 ? null : new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        stoppedErrorMessage: i < 120 ? null : 'Demo stopped campaign error state',
      };
    } else if (preset.status === 'draft') {
      lead.enrollment = {
        state: 'active',
        currentFlowNodeId: null,
        nextRunAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
    }

    leads.push(lead);
  }

  return leads;
}

function buildCampaignLeadsForPreset(preset: CampaignPreset): CampaignLeadSpec[] {
  if (preset.key === 'running-primary') {
    return buildRunningPrimaryLeads();
  }
  return buildSecondaryCampaignLeads(preset);
}

export function buildDemoHubSeedSpecs(): CampaignGraphSpec[] {
  return CAMPAIGN_PRESETS.map((preset) => ({
    namespace: `${DEMO_HUB_NAMESPACE}-${preset.key}`,
    campaignId: preset.campaignId,
    name: preset.name,
    status: preset.status,
    flowKind: preset.flowKind,
    mailboxes: DEMO_HUB_MAILBOX_SPECS,
    leads: buildCampaignLeadsForPreset(preset),
    replacements: preset.key === 'running-primary' ? buildRunningReplacementSpecs() : undefined,
  }));
}

export function getDemoHubSeedSummary() {
  const specs = buildDemoHubSeedSpecs();
  const totalLeads = specs.reduce((sum, spec) => sum + spec.leads.length, 0);
  const totalThreads = specs.reduce(
    (sum, spec) => sum + spec.leads.filter((lead) => lead.thread).length,
    0,
  );
  const statTargets = DEMO_HUB_CAMPAIGN_STAT_TARGETS.map((target) => ({
    campaignId: target.campaignId,
    ...deriveCampaignStatsFromSent(
      target.targetSent,
      target.replyRate,
      target.positiveShareOfReplies,
    ),
  }));

  return {
    campaignCount: specs.length,
    totalLeads,
    totalThreads,
    campaignIds: CAMPAIGN_PRESETS.map((preset) => preset.campaignId),
    mailboxEmails: DEMO_HUB_MAILBOX_SPECS.map((mailbox) => mailbox.emailAddress),
    statTargets,
    accountName: DEMO_ACCOUNT_NAME,
  };
}

export function getDemoHubStatTargetForCampaign(campaignId: string): DemoHubCampaignStatTarget | undefined {
  return DEMO_HUB_CAMPAIGN_STAT_TARGETS.find((target) => target.campaignId === campaignId);
}
