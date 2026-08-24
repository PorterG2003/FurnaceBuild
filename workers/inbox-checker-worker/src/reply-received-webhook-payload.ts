import { getDisplayBody } from '@furnace/email-lib';

export const REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS = 16_000;

export type ReplyReceivedWebhookPayload = {
  thread_id: string;
  email_message_id: string;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  enrollment_id: string;
  mailbox_id: string;
  mailbox_email: string;
  from_email: string;
  subject: string;
  body_text: string;
  received_at: string;
};

export function campaignNameFromRelation(campaigns: unknown): string | null {
  const row = Array.isArray(campaigns) ? campaigns[0] : campaigns;
  if (!row || typeof row !== 'object') return null;
  const name = (row as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : null;
}

export function buildReplyWebhookBodyText(bodyText: string | null | undefined): string {
  const display = getDisplayBody(bodyText ?? '');
  const source = display.trim() ? display : (bodyText ?? '');
  if (source.length <= REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS) return source;
  return source.slice(0, REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS);
}

export function buildReplyReceivedWebhookPayload(input: {
  threadId: string;
  emailMessageId: string;
  campaignId: string;
  campaignName?: string | null;
  leadId: string;
  enrollmentId: string;
  mailboxId: string;
  mailboxEmail: string;
  fromEmail: string;
  subject: string;
  bodyText?: string | null;
  receivedAt: string;
}): ReplyReceivedWebhookPayload {
  return {
    thread_id: input.threadId,
    email_message_id: input.emailMessageId,
    campaign_id: input.campaignId,
    campaign_name: input.campaignName?.trim() ? input.campaignName : null,
    lead_id: input.leadId,
    enrollment_id: input.enrollmentId,
    mailbox_id: input.mailboxId,
    mailbox_email: input.mailboxEmail,
    from_email: input.fromEmail,
    subject: input.subject,
    body_text: buildReplyWebhookBodyText(input.bodyText),
    received_at: input.receivedAt,
  };
}
