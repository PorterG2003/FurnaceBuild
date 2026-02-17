import type { BounceClassification } from './types.js';
import { stripHtml } from './strip-html.js';

const HARD_SMTP_CODES = ['550', '551', '552', '553', '554', '5.1.1', '5.1.2', '5.2.1', '5.2.2'];
const SOFT_SMTP_CODES = ['421', '450', '451', '452', '4.0.0', '4.1.1', '4.2.1', '4.2.2'];
const ALL_SMTP_CODES = [...HARD_SMTP_CODES, ...SOFT_SMTP_CODES];

function extractBodyForCodes(message: { bodyText: string | null; bodyHtml: string | null }): string {
  const text = (message.bodyText || '').toLowerCase();
  if (text.length > 0) return text;
  return stripHtml(message.bodyHtml || '').toLowerCase();
}

export function classifyBounce(message: {
  bodyText: string | null;
  bodyHtml: string | null;
}): BounceClassification {
  const body = extractBodyForCodes(message);
  for (const code of HARD_SMTP_CODES) {
    if (body.includes(code)) return { severity: 'hard', smtpCode: code };
  }
  for (const code of SOFT_SMTP_CODES) {
    if (body.includes(code)) return { severity: 'soft', smtpCode: code };
  }
  return { severity: 'unknown' };
}

export function getSmtpCodeFromBody(message: { bodyText: string | null; bodyHtml: string | null }): string | undefined {
  const body = extractBodyForCodes(message);
  for (const code of ALL_SMTP_CODES) {
    if (body.includes(code)) return code;
  }
  return undefined;
}
