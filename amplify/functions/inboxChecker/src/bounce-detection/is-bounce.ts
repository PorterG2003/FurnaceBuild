import { stripHtml } from './strip-html.js';
import type { BounceMessageInput } from './types.js';

const BOUNCE_SUBJECTS = [
  'undelivered',
  'delivery status',
  'mail delivery failed',
  'delivery failure',
  'returned mail',
  'mail system error',
];

const BOUNCE_FROMS = ['mailer-daemon', 'postmaster', 'mail delivery subsystem'];

const SMTP_ERROR_CODES = ['550', '551', '552', '553', '554', '5.1.1', '5.1.2', '5.2.1', '5.2.2'];

function getBodyForDetection(message: BounceMessageInput): string {
  const text = (message.bodyText || '').toLowerCase();
  if (text.length > 0) return text;
  return stripHtml(message.bodyHtml || '').toLowerCase();
}

export function isBounce(message: BounceMessageInput): boolean {
  const subject = (message.subject || '').toLowerCase();
  const fromEmail = (message.from?.address || '').toLowerCase();
  const bodyText = getBodyForDetection(message);

  if (BOUNCE_SUBJECTS.some((p) => subject.includes(p))) return true;
  if (BOUNCE_FROMS.some((p) => fromEmail.includes(p))) return true;
  if (SMTP_ERROR_CODES.some((code) => bodyText.includes(code))) return true;

  return false;
}
