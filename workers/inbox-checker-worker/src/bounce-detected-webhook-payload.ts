import {
  composeBounceReason,
  leadWebhookIdentityFromRow,
  type LeadIdentityRow,
  type LeadWebhookIdentity,
} from '@furnace/webhooks-lib';

export type BounceDetectedWebhookPayload = LeadWebhookIdentity & {
  enrollment_id: string;
  message_job_id: string;
  severity: string;
  code: string | null;
  reason: string;
  bounce_message_id: string | null;
  bounce_uid: number | null;
  candidate_emails: string[];
  matched_job_count: number;
};

export function buildBounceDetectedWebhookPayload(input: {
  campaignId: string;
  campaignName?: string | null;
  lead?: LeadIdentityRow | null;
  leadId: string;
  enrollmentId: string;
  messageJobId: string;
  mailboxId: string;
  mailboxEmail?: string | null;
  severity: string;
  code?: string | null;
  bounceMessageId?: string | null;
  bounceUid?: number | null;
  candidateEmails: string[];
  matchedJobCount: number;
}): BounceDetectedWebhookPayload {
  const identity = leadWebhookIdentityFromRow({
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    lead: input.lead ?? { id: input.leadId },
    mailboxId: input.mailboxId,
    mailboxEmail: input.mailboxEmail,
  });

  return {
    ...identity,
    lead_id: input.leadId,
    enrollment_id: input.enrollmentId,
    message_job_id: input.messageJobId,
    mailbox_id: input.mailboxId,
    severity: input.severity,
    code: input.code ?? null,
    reason: composeBounceReason(input.severity, input.code),
    bounce_message_id: input.bounceMessageId ?? null,
    bounce_uid: input.bounceUid ?? null,
    candidate_emails: input.candidateEmails,
    matched_job_count: input.matchedJobCount,
  };
}
