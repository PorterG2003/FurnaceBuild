import {
  buildBodyParagraph,
  buildDataTable,
  buildFurnaceEmail,
  buildFurnaceEmailText,
  buildSectionHeading,
  escapeHtml,
  FURNACE_EMAIL_BRAND,
} from '../buildFurnaceEmail.js';
import type { TransactionalEmail } from './types.js';

export function buildHelpMessageEmail(args: {
  topicLabel: string;
  notes: string;
  accountName: string;
  fromName: string;
  fromEmail: string;
}): TransactionalEmail {
  const { topicLabel, notes, accountName, fromName, fromEmail } = args;
  const subject = `Furnace help — ${topicLabel} — ${accountName}`;

  const bodyHtml = [
    buildBodyParagraph(
      `<strong style="color:${FURNACE_EMAIL_BRAND.textPrimary};">${escapeHtml(fromName)}</strong> (${escapeHtml(fromEmail)}) sent a Need help message.`,
    ),
    buildDataTable([
      ['Topic', topicLabel],
      ['Account', accountName],
      ['From', `${fromName} <${fromEmail}>`],
    ]),
    buildSectionHeading('Message'),
    `<p style="margin:0; font-size: 14px; line-height: 1.5; color: ${FURNACE_EMAIL_BRAND.textBody}; white-space: pre-wrap; border: 1px solid ${FURNACE_EMAIL_BRAND.tableBorder}; border-radius: 8px; padding: 12px;">${escapeHtml(notes)}</p>`,
  ].join('');

  const bodyText = [
    `Topic: ${topicLabel}`,
    `Account: ${accountName}`,
    `From: ${fromName} <${fromEmail}>`,
    '',
    notes,
  ].join('\n');

  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Need help message',
      pageTitle: 'Need help',
      bodyHtml,
    }),
    text: buildFurnaceEmailText({
      title: `Furnace help — ${topicLabel}`,
      bodyText,
    }),
  };
}
