import {
  buildBodyParagraph,
  buildFurnaceEmail,
  buildFurnaceEmailText,
  escapeHtml,
  FURNACE_EMAIL_BRAND,
} from '../buildFurnaceEmail.js';
import type { TransactionalEmail } from './types.js';

export function buildPlatformInviteEmail(args: {
  inviterName: string;
  acceptUrl: string;
  proposalTitle?: string;
  accountName?: string;
}): TransactionalEmail {
  const { inviterName, acceptUrl, proposalTitle, accountName } = args;

  const trimmedInviter = inviterName.trim();
  const trimmedAccount = accountName?.trim() ?? '';
  const customProposalTitle = proposalTitle?.trim() ?? '';

  const headline = customProposalTitle || "You're invited to Furnace";
  const subject = customProposalTitle
    ? `${customProposalTitle} — ${trimmedInviter} invited you to Furnace`
    : `${trimmedInviter} invited you to Furnace`;

  const primary = FURNACE_EMAIL_BRAND.textPrimary;

  const paragraphs = [
    buildBodyParagraph(
      'Good news — Your Furnace workspace is created and ready for you to finalize.',
    ),
  ];

  if (trimmedAccount) {
    paragraphs.push(
      buildBodyParagraph(
        `We've prepared it for <strong style="color:${primary};">${escapeHtml(trimmedAccount)}</strong>.`,
      ),
    );
  }

  paragraphs.push(
    buildBodyParagraph(
      'When you open your invite, you will review the proposal and agreement, create your password, and activate your account. The whole flow usually takes just a few minutes.',
    ),
    buildBodyParagraph(
      'We are glad you are here — click below whenever you are ready to take a look.',
    ),
  );

  const textLines = [
    'Good news — Your Furnace workspace is created and ready for you to finalize.',
    ...(trimmedAccount ? [`We've prepared it for ${trimmedAccount}.`, ''] : []),
    'Review the proposal and agreement, create your password, and activate your account when you are ready.',
  ];

  return {
    subject,
    html: buildFurnaceEmail({
      title: headline,
      pageTitle: headline,
      bodyHtml: paragraphs.join(''),
      cta: { label: 'View your invite', href: acceptUrl },
      disclaimer: "If you weren't expecting this, you can safely ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: headline,
      bodyText: textLines.join('\n'),
      cta: { label: 'View your invite', href: acceptUrl },
      disclaimer: "If you weren't expecting this, you can safely ignore this email.",
    }),
  };
}
