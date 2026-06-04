import {
  buildBodyParagraph,
  buildFurnaceEmail,
  buildFurnaceEmailText,
  escapeHtml,
  FURNACE_EMAIL_BRAND,
} from '../buildFurnaceEmail.js';

import type { TransactionalEmail } from './types.js';

export type { TransactionalEmail };

export function buildTeamInvitationEmail(args: {
  accountName: string;
  inviterName: string;
  inviterEmail: string;
  acceptUrl: string;
}): TransactionalEmail {
  const { accountName, inviterName, inviterEmail, acceptUrl } = args;
  const subject = `You've been invited to join ${accountName} on Furnace`;

  const bodyHtml = [
    buildBodyParagraph(
      `<strong style="color:${FURNACE_EMAIL_BRAND.textPrimary};">${escapeHtml(inviterName)}</strong> (${escapeHtml(inviterEmail)}) has invited you to join <strong style="color:${FURNACE_EMAIL_BRAND.textPrimary};">${escapeHtml(accountName)}</strong> on Furnace.`,
    ),
    buildBodyParagraph(
      'Furnace helps you build and manage automated cold email campaigns. Click the button below to accept the invitation and get started.',
    ),
  ].join('');

  const bodyText = [
    `${inviterName} (${inviterEmail}) has invited you to join ${accountName} on Furnace.`,
    '',
    'Furnace helps you build and manage automated cold email campaigns.',
  ].join('\n');

  return {
    subject,
    html: buildFurnaceEmail({
      title: "You've been invited",
      pageTitle: 'Team Invitation',
      bodyHtml,
      cta: { label: 'Accept Invitation', href: acceptUrl },
      disclaimer: "If you didn't expect this invitation, you can safely ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: `You've been invited to join ${accountName} on Furnace`,
      bodyText,
      cta: { label: 'Accept your invitation', href: acceptUrl },
      disclaimer: "If you didn't expect this invitation, you can safely ignore this email.",
    }),
  };
}
