import { Resend } from 'resend';
import { buildPlatformInviteEmail } from '../../../../lib/email/transactional/presets/platformInvite.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPlatformInviteEmail(args: {
  to: string;
  inviterName: string;
  monthlyRetainerCents: number;
  acceptUrl: string;
  proposalTitle?: string;
  accountName?: string;
}) {
  const { to, inviterName, monthlyRetainerCents, acceptUrl, proposalTitle, accountName } = args;

  if (!to || !inviterName || !acceptUrl || monthlyRetainerCents == null) {
    throw new Error('Missing required fields.');
  }

  const email = buildPlatformInviteEmail({
    inviterName,
    acceptUrl,
    proposalTitle,
    accountName,
  });

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Platform invitation email sent successfully' };
}
