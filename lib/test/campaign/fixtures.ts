import type {
  CampaignEnrollmentSpec,
  CampaignLeadSpec,
  CampaignMessageJobSpec,
  CampaignThreadMessageSpec,
  CampaignThreadSpec,
} from './harness';

export function createCampaignTestNamespace(scope: string): string {
  return `campaign-${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildCampaignEnrollment(
  overrides: Partial<CampaignEnrollmentSpec> = {},
): CampaignEnrollmentSpec {
  return {
    state: 'active',
    currentFlowNodeId: null,
    nextRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    flowPosition: {},
    stoppedReason: null,
    stoppedAt: null,
    stoppedErrorMessage: null,
    ...overrides,
  };
}

export function buildCampaignJob(
  overrides: Partial<CampaignMessageJobSpec> = {},
): CampaignMessageJobSpec {
  const scheduledAt = overrides.scheduledAt ?? new Date().toISOString();
  const status = overrides.status ?? 'queued';
  return {
    key: 'job',
    nodeFlowNodeId: 'email-1',
    status,
    scheduledAt,
    reservedAt: null,
    leaseExpiresAt: null,
    claimToken: null,
    sendingStartedAt: null,
    sentAt: status === 'sent' ? scheduledAt : null,
    providerMessageId: null,
    messageType: 'campaign',
    messageData: { source: 'campaign_seed' },
    mailboxKey: 'mailbox-1',
    ...overrides,
  };
}

export function buildThreadMessage(
  overrides: Partial<CampaignThreadMessageSpec> = {},
): CampaignThreadMessageSpec {
  const receivedAt = overrides.receivedAt ?? new Date().toISOString();
  return {
    direction: 'sent',
    bodyText: 'Seeded thread message',
    bodyHtml: null,
    fromEmail: undefined,
    fromName: null,
    toEmail: undefined,
    toName: null,
    toEmails: undefined,
    cc: null,
    receivedAt,
    readAt: receivedAt,
    messageId: null,
    inReplyTo: null,
    messageReferences: null,
    ...overrides,
  };
}

export function buildCampaignThread(
  overrides: Partial<CampaignThreadSpec> = {},
): CampaignThreadSpec {
  const lastMessageAt = overrides.lastMessageAt ?? new Date().toISOString();
  return {
    key: 'thread',
    subject: 'Seeded thread',
    lastMessageAt,
    messageCount: overrides.messages?.length ?? 2,
    hasReply: true,
    category: null,
    categorySource: null,
    outOfOffice: false,
    oooResumeRequested: false,
    oooResumeAt: null,
    oooResumeProcessedAt: null,
    messageJobKey: null,
    messages: [
      buildThreadMessage({ direction: 'sent', receivedAt: lastMessageAt, readAt: lastMessageAt }),
      buildThreadMessage({ direction: 'received', receivedAt: lastMessageAt, readAt: null }),
    ],
    ...overrides,
  };
}

export function buildCampaignLead(
  overrides: Partial<CampaignLeadSpec> & Pick<CampaignLeadSpec, 'key' | 'email'>,
): CampaignLeadSpec {
  const firstName = overrides.firstName ?? 'Seed';
  const lastName = overrides.lastName ?? overrides.key.replace(/[-_]/g, ' ');
  return {
    key: overrides.key,
    email: overrides.email,
    name: overrides.name ?? `${firstName} ${lastName}`,
    firstName,
    lastName,
    companyName: overrides.companyName ?? 'Seed Company',
    phoneNumber: overrides.phoneNumber ?? null,
    mailboxKey: overrides.mailboxKey ?? 'mailbox-1',
    source: overrides.source ?? 'campaign-fixture',
    enrollment: overrides.enrollment ?? null,
    jobs: overrides.jobs ?? [],
    thread: overrides.thread ?? null,
  };
}
