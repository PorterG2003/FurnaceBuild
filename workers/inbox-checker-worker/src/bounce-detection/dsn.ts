import type { BounceMessageInput } from './types.js';

const FINAL_RECIPIENT_HEADERS = ['final-recipient', 'original-recipient', 'x-failed-recipients'];
const EMAIL_IN_ANGLE_RE = /<([^>]+@[^>]+)>/;
const ADDR_SPEC_RE = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;

function getHeaderValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (Array.isArray(v)) return (v[0] as string) ?? null;
      return (v as string) ?? null;
    }
  }
  return null;
}

/**
 * Parse DSN-style headers (RFC 3464) for the failed recipient address.
 * Checks headers like Final-Recipient, Original-Recipient, X-Failed-Recipients.
 * Returns the first email found, or null.
 */
export function parseDSNRecipient(message: BounceMessageInput): string | null {
  const headers = message.headers || {};
  for (const headerName of FINAL_RECIPIENT_HEADERS) {
    const value = getHeaderValue(headers, headerName);
    if (!value) continue;
    const angle = value.match(EMAIL_IN_ANGLE_RE);
    if (angle) return angle[1].trim().toLowerCase();
    const addr = value.match(ADDR_SPEC_RE);
    if (addr) return addr[1].trim().toLowerCase();
  }
  return null;
}
