import type {
  CampaignGraphSpec,
  CampaignLeadSpec,
  CampaignLeadReplacementSpec,
  CampaignMailboxSpec,
  CampaignStatus,
} from './harness';
import { buildDefaultMailboxSpecs } from './harness';

export const DEV_DEFAULT_NAMESPACE = 'dev-default';
export const DEV_DEFAULT_MAILBOX_COUNT = 50;
export const DEV_DEFAULT_CAMPAIGN_IDS = [
  'f0000000-0000-4000-8000-00000000dd01',
  'f0000000-0000-4000-8000-00000000dd02',
  'f0000000-0000-4000-8000-00000000dd03',
  'f0000000-0000-4000-8000-00000000dd04',
  'f0000000-0000-4000-8000-00000000dd05',
] as const;

export const DEV_DEFAULT_TOTAL_LEADS = 1_250;
export const DEV_DEFAULT_CONVERSATION_COUNT = 10;
export const DEV_DEFAULT_MAILBOX_SPECS: CampaignMailboxSpec[] = buildDefaultMailboxSpecs(
  DEV_DEFAULT_NAMESPACE,
  DEV_DEFAULT_MAILBOX_COUNT,
);

type CampaignPreset = {
  campaignId: string;
  key: string;
  name: string;
  status: CampaignStatus;
  flowKind: 'emailOnly' | 'emailWaitEmail';
  leadCount: number;
};

const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    campaignId: DEV_DEFAULT_CAMPAIGN_IDS[0],
    key: 'running-primary',
    name: 'Dev Default - Running Primary',
    status: 'running',
    flowKind: 'emailWaitEmail',
    leadCount: 320,
  },
  {
    campaignId: DEV_DEFAULT_CAMPAIGN_IDS[1],
    key: 'running-secondary',
    name: 'Dev Default - Running Secondary',
    status: 'running',
    flowKind: 'emailOnly',
    leadCount: 280,
  },
  {
    campaignId: DEV_DEFAULT_CAMPAIGN_IDS[2],
    key: 'paused',
    name: 'Dev Default - Paused',
    status: 'paused',
    flowKind: 'emailOnly',
    leadCount: 240,
  },
  {
    campaignId: DEV_DEFAULT_CAMPAIGN_IDS[3],
    key: 'stopped',
    name: 'Dev Default - Stopped',
    status: 'stopped',
    flowKind: 'emailOnly',
    leadCount: 200,
  },
  {
    campaignId: DEV_DEFAULT_CAMPAIGN_IDS[4],
    key: 'draft',
    name: 'Dev Default - Draft',
    status: 'draft',
    flowKind: 'emailOnly',
    leadCount: 210,
  },
];

function mailboxKeyForIndex(index: number): string {
  return DEV_DEFAULT_MAILBOX_SPECS[index % DEV_DEFAULT_MAILBOX_SPECS.length]?.key ?? 'mailbox-1';
}

function leadEmail(campaignKey: string, index: number): string {
  return `${DEV_DEFAULT_NAMESPACE}-${campaignKey}-lead-${String(index + 1).padStart(4, '0')}@furnace.test`;
}

function leadNameParts(campaignKey: string, index: number) {
  return {
    firstName: 'Seed',
    lastName: `${campaignKey.replace(/-/g, '')}${index + 1}`,
  };
}

function buildGenericLead(campaignKey: string, index: number): CampaignLeadSpec {
  const names = leadNameParts(campaignKey, index);
  return {
    key: `${campaignKey}-lead-${index + 1}`,
    email: leadEmail(campaignKey, index),
    firstName: names.firstName,
    lastName: names.lastName,
    name: `${names.firstName} ${names.lastName}`,
    companyName: `Seed ${campaignKey} Co ${index + 1}`,
    mailboxKey: mailboxKeyForIndex(index),
    source: DEV_DEFAULT_NAMESPACE,
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

function buildPrimarySpecialSlices(): CampaignLeadSpec[] {
  const baseTime = Date.parse('2026-05-05T15:00:00.000Z');
  const iso = (offsetMinutes: number) => new Date(baseTime + offsetMinutes * 60_000).toISOString();

  return [
    {
      key: 'primary-ooo-due',
      email: `${DEV_DEFAULT_NAMESPACE}-ooo-due@furnace.test`,
      name: 'Seed OOO Due',
      firstName: 'Seed',
      lastName: 'OooDue',
      companyName: 'Seed OOO Co',
      mailboxKey: 'mailbox-1',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: iso(-180),
      },
      jobs: [
        {
          key: 'campaign-pending',
          nodeFlowNodeId: 'email-2',
          status: 'queued',
          scheduledAt: iso(-120),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
        {
          key: 'manual-reply',
          status: 'queued',
          scheduledAt: iso(-120),
          messageType: 'inbox_reply',
          messageData: { source: 'inbox_reply' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[RESUME NOW] Due out of office thread',
        lastMessageAt: iso(-90),
        outOfOffice: true,
        oooResumeRequested: true,
        oooResumeAt: iso(-60),
        oooResumeProcessedAt: null,
        messageJobKey: 'campaign-pending',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Initial seeded email before OOO.',
            receivedAt: iso(-180),
            readAt: iso(-180),
            messageId: '<dev-default-ooo-due-sent@furnace.test>',
          },
          {
            direction: 'received',
            bodyText: 'I am out of office until tomorrow.',
            receivedAt: iso(-90),
            readAt: null,
            messageId: '<dev-default-ooo-due-received@furnace.test>',
            inReplyTo: '<dev-default-ooo-due-sent@furnace.test>',
            messageReferences: '<dev-default-ooo-due-sent@furnace.test>',
          },
        ],
      },
    },
    {
      key: 'primary-ooo-future',
      email: `${DEV_DEFAULT_NAMESPACE}-ooo-future@furnace.test`,
      name: 'Seed OOO Future',
      firstName: 'Seed',
      lastName: 'OooFuture',
      companyName: 'Seed OOO Co',
      mailboxKey: 'mailbox-2',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: iso(-180),
      },
      jobs: [
        {
          key: 'campaign-pending',
          nodeFlowNodeId: 'email-2',
          status: 'reserved',
          scheduledAt: iso(360),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[RESUME LATER] Future out of office thread',
        lastMessageAt: iso(-90),
        outOfOffice: true,
        oooResumeRequested: true,
        oooResumeAt: iso(1_440),
        oooResumeProcessedAt: null,
        messageJobKey: 'campaign-pending',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Initial seeded email before future OOO.',
            receivedAt: iso(-180),
            readAt: iso(-180),
          },
          {
            direction: 'received',
            bodyText: 'Out until next week.',
            receivedAt: iso(-90),
            readAt: null,
          },
        ],
      },
    },
    {
      key: 'primary-replaced-old',
      email: `${DEV_DEFAULT_NAMESPACE}-replaced-old@furnace.test`,
      name: 'Seed Replaced Old',
      firstName: 'Seed',
      lastName: 'ReplacedOld',
      companyName: 'Seed Replacement Co',
      mailboxKey: 'mailbox-1',
      source: DEV_DEFAULT_NAMESPACE,
      deletedAt: iso(-240),
      enrollment: {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: 'replied',
        stoppedAt: iso(-240),
      },
      jobs: [
        {
          key: 'sent-history',
          nodeFlowNodeId: 'email-1',
          status: 'sent',
          scheduledAt: iso(-360),
          sentAt: iso(-350),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[REPLACED OLD] Historical thread',
        lastMessageAt: iso(-180),
        outOfOffice: false,
        oooResumeRequested: false,
        oooResumeAt: null,
        oooResumeProcessedAt: null,
        messageJobKey: 'sent-history',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Historical seeded outreach before replacement.',
            receivedAt: iso(-350),
            readAt: iso(-350),
          },
          {
            direction: 'received',
            bodyText: 'I am retiring. Please reach out to my teammate instead.',
            receivedAt: iso(-180),
            readAt: null,
          },
        ],
      },
    },
    {
      key: 'primary-replaced-new',
      email: `${DEV_DEFAULT_NAMESPACE}-replaced-new@furnace.test`,
      name: 'Seed Replaced New',
      firstName: 'Seed',
      lastName: 'ReplacedNew',
      companyName: 'Seed Replacement Co',
      mailboxKey: 'mailbox-1',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'active',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: iso(45),
        flowPosition: {},
      },
      jobs: [
        {
          key: 'pending-follow-up',
          nodeFlowNodeId: 'email-2',
          status: 'queued',
          scheduledAt: iso(60),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[REPLACED NEW] Active thread',
        lastMessageAt: iso(-30),
        outOfOffice: false,
        oooResumeRequested: false,
        oooResumeAt: null,
        oooResumeProcessedAt: null,
        messageJobKey: 'pending-follow-up',
        messages: [
          {
            direction: 'received',
            bodyText: 'Happy to take this over.',
            receivedAt: iso(-30),
            readAt: null,
          },
        ],
      },
    },
    {
      key: 'primary-normal-thread-1',
      email: `${DEV_DEFAULT_NAMESPACE}-thread-1@furnace.test`,
      name: 'Seed Thread One',
      firstName: 'Seed',
      lastName: 'ThreadOne',
      companyName: 'Seed Threads LLC',
      mailboxKey: 'mailbox-1',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: iso(-15),
        flowPosition: {},
      },
      jobs: [
        {
          key: 'sent-job',
          nodeFlowNodeId: 'email-1',
          status: 'sent',
          scheduledAt: iso(-240),
          sentAt: iso(-230),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[NORMAL] Active conversation',
        lastMessageAt: iso(-40),
        outOfOffice: false,
        oooResumeRequested: false,
        oooResumeAt: null,
        oooResumeProcessedAt: null,
        messageJobKey: 'sent-job',
        category: 'Interested',
        categorySource: 'system',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Checking in from the seeded account.',
            receivedAt: iso(-230),
            readAt: iso(-230),
          },
          {
            direction: 'received',
            bodyText: 'Thanks, send me more details.',
            receivedAt: iso(-40),
            readAt: null,
          },
        ],
      },
    },
    {
      key: 'primary-normal-thread-2',
      email: `${DEV_DEFAULT_NAMESPACE}-thread-2@furnace.test`,
      name: 'Seed Thread Two',
      firstName: 'Seed',
      lastName: 'ThreadTwo',
      companyName: 'Seed Threads LLC',
      mailboxKey: 'mailbox-2',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: iso(-30),
        flowPosition: {},
      },
      jobs: [
        {
          key: 'reserved-job',
          nodeFlowNodeId: 'email-1',
          status: 'reserved',
          scheduledAt: iso(-15),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[NORMAL] Reserved follow-up',
        lastMessageAt: iso(-20),
        hasReply: false,
        outOfOffice: false,
        messageJobKey: 'reserved-job',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Reserved job seeded for QA.',
            receivedAt: iso(-20),
            readAt: iso(-20),
          },
        ],
      },
    },
    {
      key: 'primary-completed-history',
      email: `${DEV_DEFAULT_NAMESPACE}-completed@furnace.test`,
      name: 'Seed Completed History',
      firstName: 'Seed',
      lastName: 'Completed',
      companyName: 'Seed History Inc',
      mailboxKey: 'mailbox-1',
      source: DEV_DEFAULT_NAMESPACE,
      enrollment: {
        state: 'completed',
        currentFlowNodeId: 'email-2',
        nextRunAt: null,
        flowPosition: {},
      },
      jobs: [
        {
          key: 'sent-history',
          nodeFlowNodeId: 'email-2',
          status: 'sent',
          scheduledAt: iso(-600),
          sentAt: iso(-590),
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ],
      thread: {
        key: 'thread',
        subject: '[NORMAL] Completed history thread',
        lastMessageAt: iso(-560),
        messageJobKey: 'sent-history',
        messages: [
          {
            direction: 'sent',
            bodyText: 'Completed history job.',
            receivedAt: iso(-590),
            readAt: iso(-590),
          },
          {
            direction: 'received',
            bodyText: 'We already signed.',
            receivedAt: iso(-560),
            readAt: iso(-560),
          },
        ],
      },
    },
  ];
}

function buildPrimaryReplacementSpecs(): CampaignLeadReplacementSpec[] {
  return [
    {
      oldKey: 'primary-replaced-old',
      newKey: 'primary-replaced-new',
      reason: 'manual_referral',
      reasonNote: 'Seeded replacement pair for QA.',
    },
  ];
}

function buildPrimaryCampaignLeads(): CampaignLeadSpec[] {
  const leads = buildPrimarySpecialSlices();
  const conversationBase = Date.parse('2026-05-05T18:00:00.000Z');

  for (let i = leads.length; i < CAMPAIGN_PRESETS[0].leadCount; i += 1) {
    const lead = buildGenericLead(CAMPAIGN_PRESETS[0].key, i);
    if (i < 10) {
      const messageTime = new Date(conversationBase + i * 15 * 60_000).toISOString();
      lead.enrollment = {
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
      lead.jobs = [
        {
          key: 'sent-job',
          nodeFlowNodeId: 'email-1',
          status: 'sent',
          scheduledAt: messageTime,
          sentAt: messageTime,
          messageType: 'campaign',
          messageData: { source: 'campaign_seed' },
        },
      ];
      lead.thread = {
        key: 'thread',
        subject: `[NORMAL] Seed conversation ${i - 4}`,
        lastMessageAt: new Date(Date.parse(messageTime) + 10 * 60_000).toISOString(),
        outOfOffice: false,
        messageJobKey: 'sent-job',
        messages: [
          {
            direction: 'sent',
            bodyText: `Seed conversation ${i - 4} outbound message.`,
            receivedAt: messageTime,
            readAt: messageTime,
          },
          {
            direction: 'received',
            bodyText: `Seed conversation ${i - 4} reply.`,
            receivedAt: new Date(Date.parse(messageTime) + 10 * 60_000).toISOString(),
            readAt: null,
          },
        ],
      };
    } else if (i < 120) {
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
          messageData: { source: 'campaign_seed' },
        },
      ];
    } else if (i < 210) {
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
          messageData: { source: 'campaign_seed' },
        },
      ];
    } else if (i < 250) {
      lead.enrollment = {
        state: 'stopped',
        currentFlowNodeId: 'waitTime-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: i % 2 === 0 ? 'replied' : 'bounced',
        stoppedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      };
      lead.jobs = [];
    }
    leads.push(lead);
  }

  return leads;
}

function buildCampaignLeadsForPreset(preset: CampaignPreset): CampaignLeadSpec[] {
  if (preset.key === 'running-primary') {
    return buildPrimaryCampaignLeads();
  }

  const leads: CampaignLeadSpec[] = [];
  for (let i = 0; i < preset.leadCount; i += 1) {
    const lead = buildGenericLead(preset.key, i);
    if (preset.status === 'paused') {
      lead.enrollment = {
        state: 'paused',
        currentFlowNodeId: 'email-1',
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
      if (i < 20) {
        lead.jobs = [
          {
            key: 'reserved-job',
            nodeFlowNodeId: 'email-1',
            status: 'reserved',
            scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            messageType: 'campaign',
            messageData: { source: 'campaign_seed' },
          },
        ];
      }
    } else if (preset.status === 'stopped') {
      lead.enrollment = {
        state: i < 40 ? 'completed' : 'stopped',
        currentFlowNodeId: 'email-1',
        nextRunAt: null,
        flowPosition: {},
        stoppedReason: i < 40 ? null : 'error',
        stoppedAt: i < 40 ? null : new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        stoppedErrorMessage: i < 40 ? null : 'Seeded stopped campaign error state',
      };
    } else if (preset.status === 'draft') {
      lead.enrollment = {
        state: 'active',
        currentFlowNodeId: null,
        nextRunAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
    } else {
      lead.enrollment = {
        state: i < 40 ? 'completed' : 'active',
        currentFlowNodeId: i < 40 ? 'email-1' : null,
        nextRunAt:
          i < 40
            ? null
            : new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        flowPosition: {},
      };
      if (i < 30) {
        lead.jobs = [
          {
            key: 'pending-job',
            nodeFlowNodeId: 'email-1',
            status: i % 3 === 0 ? 'reserved' : 'queued',
            scheduledAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            messageType: 'campaign',
            messageData: { source: 'campaign_seed' },
          },
        ];
      }
    }
    leads.push(lead);
  }

  return leads;
}

export function buildProductionLikeSeedSpecs(): CampaignGraphSpec[] {
  return CAMPAIGN_PRESETS.map((preset) => ({
    namespace: `${DEV_DEFAULT_NAMESPACE}-${preset.key}`,
    campaignId: preset.campaignId,
    name: preset.name,
    status: preset.status,
    flowKind: preset.flowKind,
    mailboxes: DEV_DEFAULT_MAILBOX_SPECS,
    leads: buildCampaignLeadsForPreset(preset),
    replacements: preset.key === 'running-primary' ? buildPrimaryReplacementSpecs() : undefined,
  }));
}

export function getProductionLikeSeedSummary() {
  const specs = buildProductionLikeSeedSpecs();
  const totalLeads = specs.reduce((sum, spec) => sum + spec.leads.length, 0);
  const totalThreads = specs.reduce(
    (sum, spec) => sum + spec.leads.filter((lead) => lead.thread).length,
    0,
  );
  return {
    campaignCount: specs.length,
    totalLeads,
    totalThreads,
    campaignIds: CAMPAIGN_PRESETS.map((preset) => preset.campaignId),
    mailboxEmails: DEV_DEFAULT_MAILBOX_SPECS.map((mailbox) => mailbox.emailAddress),
  };
}
