import { Resend } from 'resend';
import { buildHelpMessageEmail } from '../../../../lib/email/transactional/presets/helpMessage.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const HELP_TO: Record<'porter' | 'kyle', string> = {
  porter: 'porter@getfurnace.io',
  kyle: 'kyle@getfurnace.io',
};
const MAX_NOTES_LENGTH = 4000;

export async function sendHelpMessageEmail(args: {
  fromName: string;
  fromEmail: string;
  accountName: string;
  topicLabel: string;
  notes: string;
  recipient: 'porter' | 'kyle';
}) {
  const fromName = args.fromName.trim();
  const fromEmail = args.fromEmail.trim();
  const accountName = args.accountName.trim() || 'Unknown';
  const topicLabel = args.topicLabel.trim() || 'Technical support';
  const notes = args.notes.trim();
  const to = HELP_TO[args.recipient] ?? HELP_TO.porter;

  if (!fromEmail || !notes) {
    throw new Error('Missing required fields.');
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error('Message is too long.');
  }

  const email = buildHelpMessageEmail({
    topicLabel,
    notes,
    accountName,
    fromName: fromName || fromEmail,
    fromEmail,
  });

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [to],
    replyTo: fromEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Help message sent successfully' };
}
