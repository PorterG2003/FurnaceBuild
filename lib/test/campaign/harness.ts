import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSeedEnv } from '../../../scripts/seed/env';
import type { Json } from '../../supabase/types/database';
import type { ReplacementReason } from '../../supabase/types';

type DbClient = SupabaseClient;

export type CampaignFlowKind = 'emailOnly' | 'emailWaitEmail';
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'stopped';
export type EnrollmentState = 'active' | 'paused' | 'stopped' | 'completed';
export type EnrollmentStoppedReason = 'replied' | 'bounced' | 'unsubscribed' | 'error';
export type MessageJobStatus =
  | 'pending'
  | 'reserved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'blocked';
export type MessageJobType = 'campaign' | 'inbox_reply' | 'inbox_forward';

export type CampaignMailboxSpec = {
  key: string;
  emailAddress: string;
  displayName: string;
};

export type CampaignThreadMessageSpec = {
  direction: 'sent' | 'received';
  subject?: string;
  bodyText: string;
  bodyHtml?: string | null;
  fromEmail?: string;
  fromName?: string | null;
  toEmail?: string;
  toName?: string | null;
  receivedAt: string;
  readAt?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  messageReferences?: string | null;
};

export type CampaignThreadSpec = {
  key?: string;
  subject: string;
  lastMessageAt: string;
  messageCount?: number;
  hasReply?: boolean;
  category?: string | null;
  categorySource?: string | null;
  outOfOffice?: boolean;
  oooResumeRequested?: boolean;
  oooResumeAt?: string | null;
  oooResumeProcessedAt?: string | null;
  messageJobKey?: string | null;
  messages?: CampaignThreadMessageSpec[];
};

export type CampaignMessageJobSpec = {
  key?: string;
  nodeFlowNodeId?: string | null;
  status?: MessageJobStatus;
  scheduledAt?: string;
  reservedAt?: string | null;
  sentAt?: string | null;
  providerMessageId?: string | null;
  messageType?: MessageJobType;
  messageData?: Record<string, unknown>;
  mailboxKey?: string;
};

export type CampaignEnrollmentSpec = {
  state?: EnrollmentState;
  currentFlowNodeId?: string | null;
  nextRunAt?: string | null;
  flowPosition?: Json | null;
  stoppedReason?: EnrollmentStoppedReason | null;
  stoppedAt?: string | null;
  stoppedErrorMessage?: string | null;
};

export type CampaignLeadSpec = {
  key: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phoneNumber?: string | null;
  status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
  mailboxKey?: string;
  source?: string | null;
  enrollment?: CampaignEnrollmentSpec | null;
  jobs?: CampaignMessageJobSpec[];
  thread?: CampaignThreadSpec | null;
};

export type CampaignLeadReplacementSpec = {
  oldKey: string;
  newKey: string;
  reason: ReplacementReason;
  reasonNote?: string | null;
};

export type CampaignGraphSpec = {
  namespace: string;
  campaignId?: string;
  name: string;
  status?: CampaignStatus;
  flowKind?: CampaignFlowKind;
  sendingIntervalSeconds?: number;
  schedule?: Json;
  mailboxes?: CampaignMailboxSpec[];
  leads: CampaignLeadSpec[];
  replacements?: CampaignLeadReplacementSpec[];
};

export type CampaignGraphManifest = {
  namespace: string;
  accountId: string;
  campaignIds: string[];
  campaignMailboxes: Array<{ campaignId: string; mailboxId: string }>;
  mailboxIds: string[];
  mailboxEmails: string[];
  leadIds: string[];
  enrollmentIds: string[];
  messageJobIds: string[];
  threadIds: string[];
  messageIds: string[];
  replacementIds: string[];
};

type MaterializedLead = {
  key: string;
  leadId: string;
  enrollmentId: string | null;
  messageJobIdsByKey: Map<string, string>;
  threadId: string | null;
};

export type MaterializedCampaignGraph = {
  manifest: CampaignGraphManifest;
  campaignId: string;
  bucketId: string;
  accountId: string;
  mailboxIdsByKey: Map<string, string>;
  mailboxEmailsByKey: Map<string, string>;
  nodeIdsByFlowNodeId: Map<string, string>;
  leadsByKey: Map<string, MaterializedLead>;
};

export type CampaignHarnessEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  accountId: string;
  ownerUserId: string;
};

type MaterializeCampaignGraphParams = {
  supabase: DbClient;
  accountId: string;
  ownerUserId: string;
  spec: CampaignGraphSpec;
  resetExistingCampaignSlice?: boolean;
};

const DEFAULT_SENDING_INTERVAL_SECONDS = 300;
const DEFAULT_MAILBOX_COUNT = 2;
const INSERT_CHUNK_SIZE = 250;
const NODE_SYNC_TIMEOUT_MS = 30_000;
const NODE_SYNC_POLL_MS = 250;

const DEFAULT_EMAIL_VARIANT_IDS = [
  'f0000000-0000-4000-8000-00000000ea11',
  'f0000000-0000-4000-8000-00000000ea12',
] as const;
const DEFAULT_SECOND_EMAIL_VARIANT_IDS = [
  'f0000000-0000-4000-8000-00000000eb21',
  'f0000000-0000-4000-8000-00000000eb22',
] as const;

function chunk<T>(items: T[], size = INSERT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildAlwaysOnSchedule(): Json {
  return {
    timezone: 'UTC',
    start_hour: 0,
    start_minute: 0,
    end_hour: 23,
    end_minute: 59,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
  } as unknown as Json;
}

export function buildFlowData(flowKind: CampaignFlowKind): Json {
  if (flowKind === 'emailWaitEmail') {
    return {
      nodes: [
        {
          id: 'leadSource-1',
          type: 'leadSource',
          position: { x: 0, y: 0 },
          data: { label: 'Seed Lead Source' },
        },
        {
          id: 'email-1',
          type: 'email',
          position: { x: 220, y: 0 },
          data: {
            label: 'Initial Touch',
            variants: [
              {
                id: DEFAULT_EMAIL_VARIANT_IDS[0],
                label: 'Primary',
                subject: 'Quick check-in for {{name}}',
                template: 'Hi {{name}} - sending a seeded campaign touch for manual QA.',
                isActive: true,
                order: 0,
              },
              {
                id: DEFAULT_EMAIL_VARIANT_IDS[1],
                label: 'Backup',
                subject: 'Following up for {{name}}',
                template: 'Hi {{name}} - seeded backup variant for campaign QA.',
                isActive: true,
                order: 1,
              },
            ],
          },
        },
        {
          id: 'waitTime-1',
          type: 'waitTime',
          position: { x: 460, y: 0 },
          data: {
            label: 'Wait Step',
            wait_duration_seconds: 3600,
          },
        },
        {
          id: 'email-2',
          type: 'email',
          position: { x: 700, y: 0 },
          data: {
            label: 'Follow-up',
            variants: [
              {
                id: DEFAULT_SECOND_EMAIL_VARIANT_IDS[0],
                label: 'Follow-up Primary',
                subject: 'Checking back in with {{name}}',
                template: 'Hi {{name}} - seeded second touch after the wait step.',
                isActive: true,
                order: 0,
              },
              {
                id: DEFAULT_SECOND_EMAIL_VARIANT_IDS[1],
                label: 'Follow-up Backup',
                subject: 'Wanted to circle back with {{name}}',
                template: 'Hi {{name}} - seeded backup follow-up after the wait step.',
                isActive: true,
                order: 1,
              },
            ],
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'leadSource-1', target: 'email-1' },
        { id: 'e2', source: 'email-1', target: 'waitTime-1' },
        { id: 'e3', source: 'waitTime-1', target: 'email-2' },
      ],
    } as unknown as Json;
  }

  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Seed Lead Source' },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'Initial Touch',
          variants: [
            {
              id: DEFAULT_EMAIL_VARIANT_IDS[0],
              label: 'Primary',
              subject: 'Quick check-in for {{name}}',
              template: 'Hi {{name}} - sending a seeded campaign touch for manual QA.',
              isActive: true,
              order: 0,
            },
            {
              id: DEFAULT_EMAIL_VARIANT_IDS[1],
              label: 'Backup',
              subject: 'Following up for {{name}}',
              template: 'Hi {{name}} - seeded backup variant for campaign QA.',
              isActive: true,
              order: 1,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  } as unknown as Json;
}

export function buildDefaultMailboxSpecs(namespace: string, count = DEFAULT_MAILBOX_COUNT): CampaignMailboxSpec[] {
  return Array.from({ length: count }, (_, idx) => ({
    key: `mailbox-${idx + 1}`,
    emailAddress: `${namespace}-mb-${idx + 1}@furnace.test`,
    displayName: `Seed Mailbox ${idx + 1}`,
  }));
}

async function pollNodeIdByFlowNodeId(
  supabase: DbClient,
  campaignId: string,
  flowNodeId: string,
): Promise<string> {
  const deadline = Date.now() + NODE_SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('flow_node_id', flowNodeId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`campaign harness: node lookup failed for ${flowNodeId}: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await sleep(NODE_SYNC_POLL_MS);
  }

  throw new Error(`campaign harness: timed out waiting for node sync (${campaignId}:${flowNodeId})`);
}

async function ensureMailbox(params: {
  supabase: DbClient;
  accountId: string;
  ownerUserId: string;
  spec: CampaignMailboxSpec;
}): Promise<string> {
  const { supabase, accountId, ownerUserId, spec } = params;
  const timestamp = nowIso();

  const { data: found, error: lookupError } = await supabase
    .from('mailboxes')
    .select('id')
    .eq('email_address', spec.emailAddress)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`campaign harness: mailbox lookup failed: ${lookupError.message}`);
  }

  const basePayload = {
    account_id: accountId,
    user_id: ownerUserId,
    email_address: spec.emailAddress,
    display_name: spec.displayName,
    provider: 'gmail',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_username: spec.emailAddress,
    smtp_password: 'test-password',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_username: spec.emailAddress,
    imap_password: 'test-password',
    imap_use_ssl: true,
    status: 'connected' as const,
    deleted_at: null,
    updated_at: timestamp,
    smtp_status: 'active',
  } as any;

  if (found?.id) {
    const { error: updateError } = await supabase.from('mailboxes').update(basePayload).eq('id', found.id);
    if (updateError) {
      throw new Error(`campaign harness: mailbox update failed: ${updateError.message}`);
    }
    return found.id as string;
  }

  const { data, error } = await supabase
    .from('mailboxes')
    .insert({
      ...basePayload,
      created_at: timestamp,
    } as any)
    .select('id')
    .single();
  if (error || !data?.id) {
    throw new Error(`campaign harness: mailbox insert failed: ${error?.message ?? 'missing id'}`);
  }
  return data.id as string;
}

async function linkCampaignMailboxes(params: {
  supabase: DbClient;
  accountId: string;
  campaignId: string;
  mailboxIds: string[];
}): Promise<void> {
  const { supabase, accountId, campaignId, mailboxIds } = params;
  const { error: deleteError } = await supabase.from('campaign_mailboxes').delete().eq('campaign_id', campaignId);
  if (deleteError) {
    throw new Error(`campaign harness: campaign_mailboxes cleanup failed: ${deleteError.message}`);
  }

  const rows = mailboxIds.map((mailboxId) => ({
    campaign_id: campaignId,
    account_id: accountId,
    mailbox_id: mailboxId,
  }));
  const { error: insertError } = await supabase.from('campaign_mailboxes').insert(rows);
  if (insertError) {
    throw new Error(`campaign harness: campaign_mailboxes insert failed: ${insertError.message}`);
  }
}

async function cleanupCampaignRows(
  supabase: DbClient,
  accountId: string,
  campaignIds: string[],
  mailboxEmails: string[],
): Promise<void> {
  if (campaignIds.length === 0) return;

  const { data: threadRows, error: threadLookupError } = await supabase
    .from('email_threads')
    .select('id')
    .in('campaign_id', campaignIds);
  if (threadLookupError) {
    throw new Error(`campaign harness: thread cleanup lookup failed: ${threadLookupError.message}`);
  }
  const threadIds = (threadRows ?? []).map((row: any) => row.id as string);

  if (threadIds.length > 0) {
    const { error: messageDeleteError } = await supabase
      .from('email_messages')
      .delete()
      .in('thread_id', threadIds);
    if (messageDeleteError) {
      throw new Error(`campaign harness: email_messages cleanup failed: ${messageDeleteError.message}`);
    }
  }

  const simpleDeletes: Array<{ table: string; column: string; values: string[] }> = [
    { table: 'email_threads', column: 'campaign_id', values: campaignIds },
    { table: 'events', column: 'campaign_id', values: campaignIds },
    { table: 'campaign_stats', column: 'campaign_id', values: campaignIds },
    { table: 'message_jobs', column: 'campaign_id', values: campaignIds },
    { table: 'enrollments', column: 'campaign_id', values: campaignIds },
    { table: 'lead_replacements', column: 'campaign_id', values: campaignIds },
    { table: 'leads', column: 'campaign_id', values: campaignIds },
    { table: 'campaign_mailboxes', column: 'campaign_id', values: campaignIds },
    { table: 'campaign_intervals', column: 'campaign_id', values: campaignIds },
  ];

  for (const entry of simpleDeletes) {
    const { error } = await supabase.from(entry.table).delete().in(entry.column, entry.values);
    if (error) {
      throw new Error(`campaign harness: ${entry.table} cleanup failed: ${error.message}`);
    }
  }

  const { error: campaignError } = await supabase
    .from('campaigns')
    .delete()
    .in('id', campaignIds)
    .eq('account_id', accountId);
  if (campaignError) {
    throw new Error(`campaign harness: campaign cleanup failed: ${campaignError.message}`);
  }

  if (mailboxEmails.length > 0) {
    const timestamp = nowIso();
    const { error: mailboxError } = await supabase
      .from('mailboxes')
      .update({
        deleted_at: timestamp,
        status: 'disconnected',
        updated_at: timestamp,
      } as any)
      .eq('account_id', accountId)
      .in('email_address', mailboxEmails);
    if (mailboxError) {
      throw new Error(`campaign harness: mailbox cleanup failed: ${mailboxError.message}`);
    }
  }
}

async function upsertCampaign(params: {
  supabase: DbClient;
  accountId: string;
  ownerUserId: string;
  spec: CampaignGraphSpec;
}): Promise<{ campaignId: string; bucketId: string }> {
  const { supabase, accountId, ownerUserId, spec } = params;
  const campaignId = spec.campaignId ?? randomId();
  const timestamp = nowIso();
  const payload = {
    id: campaignId,
    name: spec.name,
    owner_id: ownerUserId,
    account_id: accountId,
    organization_id: null,
    status: spec.status ?? 'running',
    flow_data: buildFlowData(spec.flowKind ?? 'emailOnly'),
    schedule: (spec.schedule ?? buildAlwaysOnSchedule()) as any,
    sending_interval_seconds: spec.sendingIntervalSeconds ?? DEFAULT_SENDING_INTERVAL_SECONDS,
    deleted_at: null,
    updated_at: timestamp,
  } as any;

  const { data: existing, error: lookupError } = await supabase
    .from('campaigns')
    .select('id, bucket_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`campaign harness: campaign lookup failed: ${lookupError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('campaigns').update(payload).eq('id', campaignId);
    if (error) {
      throw new Error(`campaign harness: campaign update failed: ${error.message}`);
    }
    const bucketId = existing.bucket_id as string | null;
    if (bucketId) {
      return { campaignId, bucketId };
    }
  } else {
    const { error } = await supabase.from('campaigns').insert({ ...payload, created_at: timestamp }).select().single();
    if (error) {
      throw new Error(`campaign harness: campaign insert failed: ${error.message}`);
    }
  }

  const { data, error: bucketError } = await supabase
    .from('campaigns')
    .select('bucket_id')
    .eq('id', campaignId)
    .single();
  if (bucketError || !data?.bucket_id) {
    throw new Error(`campaign harness: missing bucket id after campaign upsert: ${bucketError?.message}`);
  }

  return { campaignId, bucketId: data.bucket_id as string };
}

function defaultLeadName(key: string): { name: string; firstName: string; lastName: string } {
  const suffix = key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return {
    name: `Seed ${suffix}`,
    firstName: 'Seed',
    lastName: suffix || 'Lead',
  };
}

function resolveThreadMessages(params: {
  lead: CampaignLeadSpec;
  thread: CampaignThreadSpec;
  mailboxEmail: string;
  leadEmail: string;
  mailboxDisplayName: string;
  accountId: string;
  messageJobId: string | null;
}): Array<Record<string, unknown>> {
  const {
    lead,
    thread,
    mailboxEmail,
    leadEmail,
    mailboxDisplayName,
    accountId,
    messageJobId,
  } = params;
  const messages = thread.messages ?? [];
  return messages.map((message) => ({
    id: randomId(),
    thread_id: null,
    account_id: accountId,
    message_job_id: message.direction === 'sent' ? messageJobId : null,
    direction: message.direction,
    from_email:
      message.fromEmail ??
      (message.direction === 'sent' ? mailboxEmail : leadEmail),
    from_name:
      message.fromName ??
      (message.direction === 'sent' ? mailboxDisplayName : lead.name ?? leadEmail),
    to_email:
      message.toEmail ??
      (message.direction === 'sent' ? leadEmail : mailboxEmail),
    to_name:
      message.toName ??
      (message.direction === 'sent' ? lead.name ?? leadEmail : mailboxDisplayName),
    subject: message.subject ?? thread.subject,
    body_text: message.bodyText,
    body_html: message.bodyHtml ?? null,
    message_id: message.messageId ?? null,
    in_reply_to: message.inReplyTo ?? null,
    message_references: message.messageReferences ?? null,
    received_at: message.receivedAt,
    read_at: message.readAt ?? null,
    headers: {},
    attachments: [],
    created_at: message.receivedAt,
    updated_at: message.receivedAt,
  }));
}

export async function materializeCampaignGraph(
  params: MaterializeCampaignGraphParams,
): Promise<MaterializedCampaignGraph> {
  const { supabase, accountId, ownerUserId, spec, resetExistingCampaignSlice = true } = params;
  const manifest: CampaignGraphManifest = {
    namespace: spec.namespace,
    accountId,
    campaignIds: [],
    campaignMailboxes: [],
    mailboxIds: [],
    mailboxEmails: [],
    leadIds: [],
    enrollmentIds: [],
    messageJobIds: [],
    threadIds: [],
    messageIds: [],
    replacementIds: [],
  };

  const mailboxSpecs = spec.mailboxes?.length ? spec.mailboxes : buildDefaultMailboxSpecs(spec.namespace);
  let { campaignId, bucketId } = await upsertCampaign({
    supabase,
    accountId,
    ownerUserId,
    spec,
  });

  if (resetExistingCampaignSlice) {
    await cleanupCampaignRows(
      supabase,
      accountId,
      [campaignId],
      mailboxSpecs.map((mailbox) => mailbox.emailAddress),
    );
    const refreshed = await upsertCampaign({
      supabase,
      accountId,
      ownerUserId,
      spec: { ...spec, campaignId },
    });
    campaignId = refreshed.campaignId;
    bucketId = refreshed.bucketId;
    manifest.campaignIds.push(refreshed.campaignId);
  } else {
    manifest.campaignIds.push(campaignId);
  }

  const mailboxIdsByKey = new Map<string, string>();
  const mailboxEmailsByKey = new Map<string, string>();
  for (const mailbox of mailboxSpecs) {
    const mailboxId = await ensureMailbox({
      supabase,
      accountId,
      ownerUserId,
      spec: mailbox,
    });
    mailboxIdsByKey.set(mailbox.key, mailboxId);
    mailboxEmailsByKey.set(mailbox.key, mailbox.emailAddress);
    manifest.mailboxIds.push(mailboxId);
    manifest.mailboxEmails.push(mailbox.emailAddress);
  }

  await linkCampaignMailboxes({
    supabase,
    accountId,
    campaignId,
    mailboxIds: mailboxSpecs.map((mailbox) => mailboxIdsByKey.get(mailbox.key)!),
  });
  manifest.campaignMailboxes.push(
    ...mailboxSpecs.map((mailbox) => ({
      campaignId,
      mailboxId: mailboxIdsByKey.get(mailbox.key)!,
    })),
  );

  const flowNodeIds = ['email-1'];
  if ((spec.flowKind ?? 'emailOnly') === 'emailWaitEmail') {
    flowNodeIds.push('waitTime-1', 'email-2');
  }

  const nodeIdsByFlowNodeId = new Map<string, string>();
  for (const flowNodeId of flowNodeIds) {
    nodeIdsByFlowNodeId.set(
      flowNodeId,
      await pollNodeIdByFlowNodeId(supabase, campaignId, flowNodeId),
    );
  }

  const leadRows: Record<string, unknown>[] = [];
  const enrollmentRows: Record<string, unknown>[] = [];
  const jobRows: Record<string, unknown>[] = [];
  const threadRows: Record<string, unknown>[] = [];
  const messageRows: Record<string, unknown>[] = [];
  const leadsByKey = new Map<string, MaterializedLead>();

  for (const leadSpec of spec.leads) {
    const leadId = randomId();
    const leadStatus = leadSpec.status ?? 'new';
    const defaultName = defaultLeadName(leadSpec.key);
    const mailboxKey = leadSpec.mailboxKey ?? mailboxSpecs[manifest.leadIds.length % mailboxSpecs.length]?.key;
    const mailboxId = mailboxKey ? mailboxIdsByKey.get(mailboxKey) ?? null : null;
    const mailboxEmail = mailboxKey ? mailboxEmailsByKey.get(mailboxKey) ?? null : null;

    leadRows.push({
      id: leadId,
      campaign_id: campaignId,
      bucket_id: bucketId,
      account_id: accountId,
      email: leadSpec.email,
      name: leadSpec.name ?? defaultName.name,
      first_name: leadSpec.firstName ?? defaultName.firstName,
      last_name: leadSpec.lastName ?? defaultName.lastName,
      company_name: leadSpec.companyName ?? `${defaultName.lastName} Co`,
      phone_number: leadSpec.phoneNumber ?? null,
      source: leadSpec.source ?? spec.namespace,
      mailbox_id: mailboxId,
      status: leadStatus,
    });
    manifest.leadIds.push(leadId);

    let enrollmentId: string | null = null;
    const messageJobIdsByKey = new Map<string, string>();
    let threadId: string | null = null;

    if (leadSpec.enrollment) {
      enrollmentId = randomId();
      const enrollmentState = leadSpec.enrollment.state ?? 'active';
      const currentFlowNodeId = leadSpec.enrollment.currentFlowNodeId ?? null;
      enrollmentRows.push({
        id: enrollmentId,
        campaign_id: campaignId,
        account_id: accountId,
        lead_id: leadId,
        current_node_id: currentFlowNodeId ? nodeIdsByFlowNodeId.get(currentFlowNodeId) ?? null : null,
        state: enrollmentState,
        next_run_at:
          leadSpec.enrollment.nextRunAt ??
          (enrollmentState === 'active' ? nowIso() : null),
        flow_position: leadSpec.enrollment.flowPosition ?? {},
        stopped_reason: leadSpec.enrollment.stoppedReason ?? null,
        stopped_at: leadSpec.enrollment.stoppedAt ?? null,
        stopped_error_message: leadSpec.enrollment.stoppedErrorMessage ?? null,
      });
      manifest.enrollmentIds.push(enrollmentId);
    }

    for (const [jobIndex, jobSpec] of (leadSpec.jobs ?? []).entries()) {
      const jobId = randomId();
      const key = jobSpec.key ?? `job-${jobIndex + 1}`;
      messageJobIdsByKey.set(key, jobId);
      const status = jobSpec.status ?? 'pending';
      const messageType = jobSpec.messageType ?? 'campaign';
      const messageData =
        jobSpec.messageData ??
        (messageType === 'campaign'
          ? {
              source: 'campaign_seed',
              lead_data: {
                email: leadSpec.email,
                name: leadSpec.name ?? defaultName.name,
              },
            }
          : { source: messageType });
      const scheduledAt = jobSpec.scheduledAt ?? nowIso();
      const sentAt = jobSpec.sentAt ?? (status === 'sent' ? scheduledAt : null);
      const jobMailboxKey = jobSpec.mailboxKey ?? mailboxKey ?? mailboxSpecs[0]?.key;
      const jobMailboxId = jobMailboxKey ? mailboxIdsByKey.get(jobMailboxKey) ?? null : null;
      if (!jobMailboxId) {
        throw new Error(`campaign harness: missing mailbox for job ${key} on lead ${leadSpec.key}`);
      }
      const nodeId =
        messageType === 'campaign'
          ? nodeIdsByFlowNodeId.get(jobSpec.nodeFlowNodeId ?? 'email-1') ?? null
          : null;
      jobRows.push({
        id: jobId,
        enrollment_id: enrollmentId,
        campaign_id: campaignId,
        account_id: accountId,
        lead_id: leadId,
        mailbox_id: jobMailboxId,
        node_id: nodeId,
        status,
        scheduled_at: scheduledAt,
        reserved_at: jobSpec.reservedAt ?? null,
        sent_at: sentAt,
        provider_message_id: jobSpec.providerMessageId ?? null,
        message_data: messageData,
        message_type: messageType,
        interval_id: null,
      } as any);
      manifest.messageJobIds.push(jobId);
    }

    if (leadSpec.thread) {
      threadId = randomId();
      const threadMailboxKey = mailboxKey ?? mailboxSpecs[0]?.key;
      const threadMailboxId = threadMailboxKey ? mailboxIdsByKey.get(threadMailboxKey) ?? null : null;
      const threadMailboxEmail =
        threadMailboxKey ? mailboxEmailsByKey.get(threadMailboxKey) ?? null : null;
      if (!threadMailboxId || !threadMailboxEmail) {
        throw new Error(`campaign harness: missing mailbox for thread on lead ${leadSpec.key}`);
      }

      const messageJobId = leadSpec.thread.messageJobKey
        ? messageJobIdsByKey.get(leadSpec.thread.messageJobKey) ?? null
        : messageJobIdsByKey.values().next().value ?? null;

      threadRows.push({
        id: threadId,
        account_id: accountId,
        campaign_id: campaignId,
        lead_id: leadId,
        enrollment_id: enrollmentId,
        message_job_id: messageJobId,
        mailbox_id: threadMailboxId,
        subject: leadSpec.thread.subject,
        participants: [threadMailboxEmail, leadSpec.email],
        last_message_at: leadSpec.thread.lastMessageAt,
        message_count: leadSpec.thread.messageCount ?? (leadSpec.thread.messages?.length ?? 2),
        has_reply: leadSpec.thread.hasReply ?? true,
        category: leadSpec.thread.category ?? null,
        category_source: leadSpec.thread.categorySource ?? null,
        out_of_office: leadSpec.thread.outOfOffice ?? false,
        ooo_resume_requested: leadSpec.thread.oooResumeRequested ?? false,
        ooo_resume_at: leadSpec.thread.oooResumeAt ?? null,
        ooo_resume_processed_at: leadSpec.thread.oooResumeProcessedAt ?? null,
        created_at:
          leadSpec.thread.messages?.[0]?.receivedAt ??
          leadSpec.thread.lastMessageAt,
        updated_at: leadSpec.thread.lastMessageAt,
      });
      manifest.threadIds.push(threadId);

      const threadMessages = resolveThreadMessages({
        lead: leadSpec,
        thread: leadSpec.thread,
        mailboxEmail: threadMailboxEmail,
        leadEmail: leadSpec.email,
        mailboxDisplayName:
          mailboxSpecs.find((mailbox) => mailbox.key === threadMailboxKey)?.displayName ?? 'Seed Mailbox',
        accountId,
        messageJobId,
      });
      for (const message of threadMessages) {
        (message as any).thread_id = threadId;
        messageRows.push(message);
        manifest.messageIds.push(message.id as string);
      }
    }

    leadsByKey.set(leadSpec.key, {
      key: leadSpec.key,
      leadId,
      enrollmentId,
      messageJobIdsByKey,
      threadId,
    });
  }

  for (const batchRows of chunk(leadRows)) {
    const { error } = await supabase.from('leads').insert(batchRows as any);
    if (error) {
      throw new Error(`campaign harness: lead insert failed: ${error.message}`);
    }
  }
  for (const batchRows of chunk(enrollmentRows)) {
    const { error } = await supabase.from('enrollments').insert(batchRows as any);
    if (error) {
      throw new Error(`campaign harness: enrollment insert failed: ${error.message}`);
    }
  }
  for (const batchRows of chunk(jobRows)) {
    const { error } = await supabase.from('message_jobs').insert(batchRows as any);
    if (error) {
      throw new Error(`campaign harness: message_job insert failed: ${error.message}`);
    }
  }
  for (const batchRows of chunk(threadRows)) {
    const { error } = await supabase.from('email_threads').insert(batchRows as any);
    if (error) {
      throw new Error(`campaign harness: email_thread insert failed: ${error.message}`);
    }
  }
  for (const batchRows of chunk(messageRows)) {
    const { error } = await supabase.from('email_messages').insert(batchRows as any);
    if (error) {
      throw new Error(`campaign harness: email_message insert failed: ${error.message}`);
    }
  }

  if (spec.replacements?.length) {
    const replacementTimestamp = nowIso();
    const replacementRows = spec.replacements.map((replacement) => {
      const oldLead = leadsByKey.get(replacement.oldKey);
      const newLead = leadsByKey.get(replacement.newKey);
      if (!oldLead || !newLead) {
        throw new Error(
          `campaign harness: replacement lead keys not found (${replacement.oldKey} -> ${replacement.newKey})`,
        );
      }

      const replacementId = randomId();
      manifest.replacementIds.push(replacementId);
      return {
        id: replacementId,
        account_id: accountId,
        campaign_id: campaignId,
        old_lead_id: oldLead.leadId,
        new_lead_id: newLead.leadId,
        status: 'completed',
        reason: replacement.reason,
        reason_note: replacement.reasonNote?.trim() || null,
        source_message_id: null,
        created_by: ownerUserId,
        created_at: replacementTimestamp,
        completed_at: replacementTimestamp,
      };
    });

    const { error: replacementError } = await supabase
      .from('lead_replacements')
      .insert(replacementRows as any);
    if (replacementError) {
      throw new Error(`campaign harness: lead_replacements insert failed: ${replacementError.message}`);
    }

    const oldLeadIds = spec.replacements
      .map((replacement) => leadsByKey.get(replacement.oldKey)?.leadId)
      .filter((leadId): leadId is string => Boolean(leadId));
    if (oldLeadIds.length > 0) {
      const { error: leadArchiveError } = await supabase
        .from('leads')
        .update({
          status: 'removed',
          deleted_at: replacementTimestamp,
          updated_at: replacementTimestamp,
        } as any)
        .in('id', oldLeadIds);
      if (leadArchiveError) {
        throw new Error(`campaign harness: replacement lead archive failed: ${leadArchiveError.message}`);
      }
    }
  }

  return {
    manifest,
    campaignId,
    bucketId,
    accountId,
    mailboxIdsByKey,
    mailboxEmailsByKey,
    nodeIdsByFlowNodeId,
    leadsByKey,
  };
}

export async function cleanupCampaignGraphManifest(
  supabase: DbClient,
  manifest: CampaignGraphManifest,
): Promise<void> {
  if (manifest.messageIds.length > 0) {
    const { error } = await supabase.from('email_messages').delete().in('id', manifest.messageIds);
    if (error) {
      throw new Error(`campaign harness: exact email_message cleanup failed: ${error.message}`);
    }
  }
  if (manifest.threadIds.length > 0) {
    const { error } = await supabase.from('email_threads').delete().in('id', manifest.threadIds);
    if (error) {
      throw new Error(`campaign harness: exact email_thread cleanup failed: ${error.message}`);
    }
  }
  if (manifest.messageJobIds.length > 0) {
    const { error } = await supabase.from('message_jobs').delete().in('id', manifest.messageJobIds);
    if (error) {
      throw new Error(`campaign harness: exact message_job cleanup failed: ${error.message}`);
    }
  }
  if (manifest.enrollmentIds.length > 0) {
    const { error } = await supabase.from('enrollments').delete().in('id', manifest.enrollmentIds);
    if (error) {
      throw new Error(`campaign harness: exact enrollment cleanup failed: ${error.message}`);
    }
  }
  if (manifest.replacementIds.length > 0) {
    const { error } = await supabase.from('lead_replacements').delete().in('id', manifest.replacementIds);
    if (error) {
      throw new Error(`campaign harness: exact lead_replacements cleanup failed: ${error.message}`);
    }
  }
  if (manifest.leadIds.length > 0) {
    const { error } = await supabase.from('leads').delete().in('id', manifest.leadIds);
    if (error) {
      throw new Error(`campaign harness: exact lead cleanup failed: ${error.message}`);
    }
  }
  if (manifest.campaignIds.length > 0 || manifest.mailboxEmails.length > 0) {
    await cleanupCampaignRows(
      supabase,
      manifest.accountId,
      manifest.campaignIds,
      manifest.mailboxEmails,
    );
  }
}

export function loadCampaignHarnessEnv(): CampaignHarnessEnv {
  loadSeedEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const accountId = process.env.SEED_ACCOUNT_ID?.trim();
  const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Campaign test harness requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).',
    );
  }
  if (!accountId || !ownerUserId) {
    throw new Error('Campaign test harness requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID.');
  }

  return { supabaseUrl, serviceRoleKey, accountId, ownerUserId };
}

export function createCampaignHarnessClient(env = loadCampaignHarnessEnv()): DbClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
}

export class CampaignDbHarness {
  readonly namespace: string;
  readonly env: CampaignHarnessEnv;
  readonly supabase: DbClient;
  private readonly manifests: CampaignGraphManifest[] = [];

  constructor(params: { namespace: string; env?: CampaignHarnessEnv }) {
    this.namespace = params.namespace;
    this.env = params.env ?? loadCampaignHarnessEnv();
    this.supabase = createCampaignHarnessClient(this.env);
  }

  async createCampaignGraph(spec: Omit<CampaignGraphSpec, 'namespace'>): Promise<MaterializedCampaignGraph> {
    const graph = await materializeCampaignGraph({
      supabase: this.supabase,
      accountId: this.env.accountId,
      ownerUserId: this.env.ownerUserId,
      spec: {
        ...spec,
        namespace: `${this.namespace}-${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 48),
      },
      resetExistingCampaignSlice: true,
    });
    this.manifests.push(graph.manifest);
    return graph;
  }

  recordReplacement(params: { replacementId: string; newLeadId: string }): void {
    const manifest = this.manifests.at(-1);
    if (!manifest) {
      throw new Error('campaign harness: cannot record replacement without a manifest');
    }
    if (!manifest.replacementIds.includes(params.replacementId)) {
      manifest.replacementIds.push(params.replacementId);
    }
    if (!manifest.leadIds.includes(params.newLeadId)) {
      manifest.leadIds.push(params.newLeadId);
    }
  }

  async cleanup(): Promise<void> {
    for (const manifest of [...this.manifests].reverse()) {
      await cleanupCampaignGraphManifest(this.supabase, manifest);
    }
    this.manifests.length = 0;
  }
}
