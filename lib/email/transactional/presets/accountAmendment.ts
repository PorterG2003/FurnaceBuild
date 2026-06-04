import {
  buildBodyParagraph,
  buildFurnaceEmail,
  buildFurnaceEmailText,
  escapeHtml,
  FURNACE_EMAIL_BRAND,
} from '../buildFurnaceEmail.js';
import type { TransactionalEmail } from './types.js';

export function buildAccountAmendmentEmail(args: {
  inviterName: string;
  acceptUrl: string;
  accountName?: string;
}): TransactionalEmail {
  const { inviterName, acceptUrl, accountName } = args;
  const subject = 'Your Furnace agreement was updated — action required';

  const paragraphs = [
    buildBodyParagraph(
      `<strong style="color:${FURNACE_EMAIL_BRAND.textPrimary};">${escapeHtml(inviterName)}</strong> published an updated agreement for your Furnace workspace.`,
    ),
  ];

  if (accountName?.trim()) {
    paragraphs.push(
      buildBodyParagraph(
        `<strong style="color:${FURNACE_EMAIL_BRAND.textPrimary};">Workspace:</strong> ${escapeHtml(accountName.trim())}`,
      ),
    );
  }

  paragraphs.push(
    buildBodyParagraph(
      'As the account owner, please sign in and accept the updated terms to continue without interruption.',
    ),
  );

  const textLines = [
    `${inviterName} published updated terms for your workspace.`,
    accountName?.trim() ? `Workspace: ${accountName.trim()}` : '',
  ].filter(Boolean);

  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Review updated terms',
      pageTitle: 'Agreement update',
      bodyHtml: paragraphs.join(''),
      cta: { label: 'Review and accept terms', href: acceptUrl },
    }),
    text: buildFurnaceEmailText({
      title: 'Your Furnace agreement was updated.',
      bodyText: textLines.join('\n'),
      cta: { label: 'Review and accept', href: acceptUrl },
    }),
  };
}
