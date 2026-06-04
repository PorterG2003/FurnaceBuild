import { Resend } from 'resend';
import { buildTeamInvitationEmail } from '../../../../lib/email/transactional/presets/teamInvitation.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendTeamInvitationEmail(args: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  accountName: string;
  acceptUrl?: string;
}) {
  const { to, inviterName, inviterEmail, accountName, acceptUrl } = args;

  if (!to || !inviterName || !accountName) {
    throw new Error('Missing required fields: to, inviterName, and accountName are required');
  }

  const defaultAcceptUrl = acceptUrl || 'https://your-app-url.com/accept-invitation';
  const email = buildTeamInvitationEmail({
    accountName,
    inviterName,
    inviterEmail,
    acceptUrl: defaultAcceptUrl,
  });

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Invitation email sent successfully' };
}
