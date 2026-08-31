import {
  leadWebhookIdentityFromRow,
  truncateWebhookBodyText,
  type LeadIdentityRow,
  type LeadWebhookIdentity,
} from '@furnace/webhooks-lib';

export type EmailSentWebhookPayload = Omit<
  LeadWebhookIdentity,
  'campaign_name' | 'email' | 'mailbox_id' | 'mailbox_email'
> & {
  campaign_name: string | null;
  email: string;
  enrollment_id: string;
  message_job_id: string;
  mailbox_id: string;
  mailbox_email: string;
  provider_message_id: string | null;
  sent_at: string;
  subject: string;
  body_text?: string;
  step_number?: number;
  node_id?: string;
  flow_node_id?: string;
};

export function buildEmailSentWebhookPayload(input: {
  campaignId: string;
  campaignName?: string | null;
  leadId: string;
  email: string;
  enrollmentId: string;
  messageJobId: string;
  mailboxId: string;
  mailboxEmail: string;
  providerMessageId?: string | null;
  sentAt: string;
  subject: string;
  bodyText?: string | null;
  stepNumber?: number | null;
  nodeId?: string | null;
  flowNodeId?: string | null;
  lead?: LeadIdentityRow | null;
}): EmailSentWebhookPayload {
  const identity = leadWebhookIdentityFromRow({
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    lead: input.lead ?? {
      id: input.leadId,
      email: input.email,
    },
    mailboxId: input.mailboxId,
    mailboxEmail: input.mailboxEmail,
  });

  const payload: EmailSentWebhookPayload = {
    ...identity,
    campaign_name: input.campaignName?.trim() ? input.campaignName : null,
    email: input.email,
    enrollment_id: input.enrollmentId,
    message_job_id: input.messageJobId,
    mailbox_id: input.mailboxId,
    mailbox_email: input.mailboxEmail,
    provider_message_id: input.providerMessageId ?? null,
    sent_at: input.sentAt,
    subject: input.subject,
  };

  const bodyText = input.bodyText?.trim()
    ? truncateWebhookBodyText(input.bodyText)
    : undefined;
  if (bodyText) payload.body_text = bodyText;
  if (typeof input.stepNumber === 'number' && Number.isFinite(input.stepNumber)) {
    payload.step_number = input.stepNumber;
  }
  if (input.nodeId?.trim()) payload.node_id = input.nodeId;
  if (input.flowNodeId?.trim()) payload.flow_node_id = input.flowNodeId;

  return payload;
}
