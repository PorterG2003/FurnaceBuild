import {
  leadWebhookIdentityFromRow,
  type LeadIdentityRow,
  type LeadWebhookIdentity,
} from '@furnace/webhooks-lib';

export type UnsubscribeDetectedWebhookPayload = LeadWebhookIdentity & {
  enrollment_id: string;
  source: 'reply_opt_out';
};

export function buildUnsubscribeDetectedWebhookPayload(input: {
  campaignId: string;
  campaignName?: string | null;
  lead?: LeadIdentityRow | null;
  leadId: string;
  enrollmentId: string;
  mailboxId: string;
  mailboxEmail?: string | null;
}): UnsubscribeDetectedWebhookPayload {
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
    mailbox_id: input.mailboxId,
    source: 'reply_opt_out',
  };
}
