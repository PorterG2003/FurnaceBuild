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

export type FluxQuizAnswerRow = {
  prompt: string;
  answerText: string;
};

export function buildFluxQuizSubmissionEmail(args: {
  companyName: string;
  prospectName: string;
  pageUrl: string;
  pageSlug: string;
  prospectDetails: Array<[string, string]>;
  answerRows: FluxQuizAnswerRow[];
  notes?: string;
}): TransactionalEmail {
  const { companyName, prospectName, pageUrl, pageSlug, prospectDetails, answerRows, notes } = args;
  const subject = `Quiz submission for ${companyName}`;

  const bodyHtml = [
    buildBodyParagraph(
      `A visitor completed the quiz on <a href="${escapeHtml(pageUrl)}" style="color:${FURNACE_EMAIL_BRAND.accent}; text-decoration:none;">${escapeHtml(pageUrl)}</a>.`,
    ),
    buildSectionHeading('Prospect context'),
    buildDataTable(prospectDetails),
    buildSectionHeading('Answers'),
    buildDataTable(answerRows.map((row) => [row.prompt, row.answerText] as [string, string])),
    notes
      ? `${buildSectionHeading('Prospect notes')}<p style="margin:0; font-size: 14px; line-height: 1.5; color: ${FURNACE_EMAIL_BRAND.textBody}; white-space: pre-wrap; border: 1px solid ${FURNACE_EMAIL_BRAND.tableBorder}; border-radius: 8px; padding: 12px;">${escapeHtml(notes)}</p>`
      : '',
  ].join('');

  const textLines = [
    `Prospect: ${prospectName}`,
    `Company: ${companyName}`,
    ...prospectDetails.map(([label, value]) => `${label}: ${value}`),
    `Page URL: ${pageUrl}`,
    `Page slug: ${pageSlug}`,
    '',
    'Answers:',
    ...answerRows.map((row) => `- ${row.prompt}: ${row.answerText}`),
    ...(notes ? ['', 'Prospect notes:', notes] : []),
  ];

  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Quiz and book submission',
      pageTitle: 'Quiz and book submission',
      bodyHtml,
    }),
    text: buildFurnaceEmailText({
      title: 'Quiz and book submission',
      bodyText: textLines.join('\n'),
    }),
  };
}
