import { stripHtml } from './strip-html.js';
import { parseDSNRecipient } from './dsn.js';
import type { BounceMessageInput } from './types.js';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function extractCandidateEmails(message: BounceMessageInput): string[] {
  const out = new Set<string>();

  const dsnRecipient = parseDSNRecipient(message);
  if (dsnRecipient) out.add(dsnRecipient);

  let body = message.bodyText ?? '';
  if (!body.trim() && message.bodyHtml) {
    body = stripHtml(message.bodyHtml);
  }
  const matches = body.match(EMAIL_RE) || [];
  for (const e of matches) {
    out.add(e.toLowerCase().trim());
  }

  const toAddr = message.to[0]?.address?.toLowerCase();
  if (toAddr) out.add(toAddr);

  return [...out];
}
