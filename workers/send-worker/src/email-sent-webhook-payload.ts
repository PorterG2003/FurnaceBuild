export type EmailSentWebhookPayload = {
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  email: string;
  enrollment_id: string;
  message_job_id: string;
  mailbox_id: string;
  mailbox_email: string;
  provider_message_id: string | null;
  sent_at: string;
  subject: string;
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
}): EmailSentWebhookPayload {
  return {
    campaign_id: input.campaignId,
    campaign_name: input.campaignName?.trim() ? input.campaignName : null,
    lead_id: input.leadId,
    email: input.email,
    enrollment_id: input.enrollmentId,
    message_job_id: input.messageJobId,
    mailbox_id: input.mailboxId,
    mailbox_email: input.mailboxEmail,
    provider_message_id: input.providerMessageId ?? null,
    sent_at: input.sentAt,
    subject: input.subject,
  };
}
