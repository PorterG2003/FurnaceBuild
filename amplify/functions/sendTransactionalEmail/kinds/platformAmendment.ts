import { Resend } from 'resend';
import { buildAccountAmendmentEmail } from '../../../../lib/email/transactional/presets/accountAmendment.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPlatformAmendmentEmail(args: {
  to: string;
  inviterName: string;
  acceptUrl: string;
  accountName?: string;
}) {
  const email = buildAccountAmendmentEmail({
    inviterName: args.inviterName,
    acceptUrl: args.acceptUrl,
    accountName: args.accountName,
  });

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [args.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Platform amendment email sent successfully' };
}
