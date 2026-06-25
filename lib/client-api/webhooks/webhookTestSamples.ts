import { buildBatchCompletionPayload } from './batchCompletion.js';
import { WEBHOOK_EVENT_GROUPS } from './eventGroups.js';
import {
  DEFAULT_ALLOWED_WEBHOOK_EVENTS,
  type WebhookEventType,
} from './webhookEvents.js';

export type WebhookTestContext = {
  accountId: string;
  campaignId?: string | null;
};

export type WebhookTestEventOption = {
  value: WebhookEventType;
  label: string;
  groupLabel: string;
};

const TEST_LEAD_ID = '00000000-0000-4000-8000-000000000001';
const TEST_ENROLLMENT_ID = '00000000-0000-4000-8000-000000000002';
const TEST_MESSAGE_JOB_ID = '00000000-0000-4000-8000-000000000003';
const TEST_MAILBOX_ID = '00000000-0000-4000-8000-000000000004';
const TEST_THREAD_ID = '00000000-0000-4000-8000-000000000005';
const TEST_EMAIL_MESSAGE_ID = '00000000-0000-4000-8000-000000000006';
const TEST_JOB_ID = '00000000-0000-4000-8000-000000000007';
const TEST_GLOBAL_LEAD_ID = '00000000-0000-4000-8000-000000000008';

function campaignId(ctx: WebhookTestContext): string {
  return ctx.campaignId ?? '00000000-0000-4000-8000-000000000099';
}

export type WebhookSampleOptions = {
  includeTestFlag?: boolean;
};

function maybeWithTestFlag(
  data: Record<string, unknown>,
  includeTestFlag: boolean,
): Record<string, unknown> {
  return includeTestFlag ? { test: true, ...data } : data;
}

function sampleTimestamp(): string {
  return '2026-06-25T12:00:00.000Z';
}

export const WEBHOOK_DOC_SAMPLE_CONTEXT: WebhookTestContext = {
  accountId: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
};

export function buildWebhookTestPayload(
  eventType: WebhookEventType,
  ctx: WebhookTestContext,
  options?: WebhookSampleOptions,
): Record<string, unknown> {
  const includeTestFlag = options?.includeTestFlag ?? true;
  const cid = campaignId(ctx);

  switch (eventType) {
    case 'lead.created':
      return maybeWithTestFlag({
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        email: 'lead@example.com',
      }, includeTestFlag);
    case 'lead.updated':
      return maybeWithTestFlag({
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        email: 'lead@example.com',
      }, includeTestFlag);
    case 'lead.deleted':
      return maybeWithTestFlag({
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        email: 'lead@example.com',
      }, includeTestFlag);
    case 'lead.bulk_import.completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: TEST_JOB_ID,
          source: 'async',
          campaignId: cid,
          operation: 'api_lead_import',
          counts: { created: 2, updated: 1, enrolled: 3, skipped: 0, failed: 0 },
          errors: [],
        }),
        includeTestFlag,
      );
    case 'lead.added_to_campaign.completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: null,
          source: 'sync',
          campaignId: cid,
          operation: 'add_to_campaign',
          counts: { enrolled: 1, skipped: 0, failed: 0 },
          globalLeadIds: [TEST_GLOBAL_LEAD_ID],
        }),
        includeTestFlag,
      );
    case 'lead.removed_from_campaign.completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: null,
          source: 'sync',
          campaignId: cid,
          operation: 'remove_from_campaign',
          counts: { removed: 1, skipped: 0, failed: 0 },
          globalLeadIds: [TEST_GLOBAL_LEAD_ID],
        }),
        includeTestFlag,
      );
    case 'lead.removed_from_all_campaigns.completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: null,
          source: 'sync',
          campaignId: null,
          operation: 'remove_from_all_campaigns',
          counts: { removed: 1, skipped: 0, failed: 0 },
          globalLeadIds: [TEST_GLOBAL_LEAD_ID],
        }),
        includeTestFlag,
      );
    case 'enrollment.pause_completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: null,
          source: 'sync',
          campaignId: cid,
          operation: 'pause_enrollments',
          counts: { paused: 1, skipped: 0, failed: 0 },
          globalLeadIds: [TEST_GLOBAL_LEAD_ID],
        }),
        includeTestFlag,
      );
    case 'enrollment.resume_completed':
      return maybeWithTestFlag(
        buildBatchCompletionPayload({
          jobId: null,
          source: 'sync',
          campaignId: cid,
          operation: 'resume_enrollments',
          counts: { resumed: 1, skipped: 0, failed: 0 },
          globalLeadIds: [TEST_GLOBAL_LEAD_ID],
        }),
        includeTestFlag,
      );
    case 'campaign.paused':
      return maybeWithTestFlag({ campaign_id: cid }, includeTestFlag);
    case 'campaign.resumed':
      return maybeWithTestFlag({ campaign_id: cid }, includeTestFlag);
    case 'campaign.stopped':
      return maybeWithTestFlag({ campaign_id: cid }, includeTestFlag);
    case 'email.sent':
      return maybeWithTestFlag({
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        enrollment_id: TEST_ENROLLMENT_ID,
        message_job_id: TEST_MESSAGE_JOB_ID,
        mailbox_id: TEST_MAILBOX_ID,
        provider_message_id: 'test-provider-message-id',
        sent_at: sampleTimestamp(),
        subject: 'Example outbound subject (test)',
      }, includeTestFlag);
    case 'reply.received':
      return maybeWithTestFlag({
        thread_id: TEST_THREAD_ID,
        email_message_id: TEST_EMAIL_MESSAGE_ID,
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        enrollment_id: TEST_ENROLLMENT_ID,
        mailbox_id: TEST_MAILBOX_ID,
        from_email: 'lead@example.com',
        subject: 'Re: Example outbound subject (test)',
        received_at: sampleTimestamp(),
      }, includeTestFlag);
    case 'bounce.detected':
      return maybeWithTestFlag({
        campaign_id: cid,
        lead_id: TEST_LEAD_ID,
        enrollment_id: TEST_ENROLLMENT_ID,
        message_job_id: TEST_MESSAGE_JOB_ID,
        mailbox_id: TEST_MAILBOX_ID,
        severity: 'hard',
        code: '550',
        bounce_message_id: 'test-bounce-message-id',
        bounce_uid: 42,
        candidate_emails: ['lead@example.com'],
        matched_job_count: 1,
      }, includeTestFlag);
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
}

export function isAllowedWebhookEventType(value: string): value is WebhookEventType {
  return (DEFAULT_ALLOWED_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export const WEBHOOK_TEST_EVENT_OPTIONS: WebhookTestEventOption[] = WEBHOOK_EVENT_GROUPS.flatMap(
  (group) =>
    group.events.map((event) => ({
      value: event,
      label: event,
      groupLabel: group.label,
    })),
);

export function defaultWebhookTestEventType(enabledGroupIds: string[]): WebhookEventType {
  for (const group of WEBHOOK_EVENT_GROUPS) {
    if (enabledGroupIds.includes(group.id) && group.events.length > 0) {
      return group.events[0];
    }
  }
  return 'email.sent';
}

export function defaultEventTypeForGroup(groupId: string): WebhookEventType {
  const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === groupId);
  return group?.events[0] ?? 'email.sent';
}

export const WEBHOOK_TEST_GROUP_OPTIONS = WEBHOOK_EVENT_GROUPS.map((group) => ({
  value: group.id,
  label: group.label,
  description: group.description,
  defaultEventType: group.events[0],
}));

const CURATED_TEST_EVENT_PRIORITY: WebhookEventType[] = ['email.sent', 'reply.received'];

export function curatedWebhookTestEventOptions(enabledGroupIds: string[]): WebhookTestEventOption[] {
  const seen = new Set<WebhookEventType>();
  const result: WebhookTestEventOption[] = [];

  const addEvent = (event: WebhookEventType) => {
    if (seen.has(event)) return;
    seen.add(event);
    const group = WEBHOOK_EVENT_GROUPS.find((entry) =>
      (entry.events as readonly WebhookEventType[]).includes(event),
    );
    result.push({
      value: event,
      label: event,
      groupLabel: group?.label ?? '',
    });
  };

  for (const event of CURATED_TEST_EVENT_PRIORITY) {
    addEvent(event);
  }

  const groupIds =
    enabledGroupIds.length > 0 ? enabledGroupIds : WEBHOOK_EVENT_GROUPS.map((group) => group.id);
  for (const groupId of groupIds) {
    const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === groupId);
    if (group?.events[0]) {
      addEvent(group.events[0]);
    }
  }

  return result;
}

export function buildWebhookSamplePreview(
  eventType: WebhookEventType,
  ctx: WebhookTestContext,
  options?: WebhookSampleOptions,
): string {
  return JSON.stringify(
    {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: eventType,
      occurred_at: sampleTimestamp(),
      data: buildWebhookTestPayload(eventType, ctx, options),
    },
    null,
    2,
  );
}

export function buildWebhookTestSamplePreview(
  eventType: WebhookEventType,
  ctx: WebhookTestContext,
): string {
  return buildWebhookSamplePreview(eventType, ctx, { includeTestFlag: true });
}
