/**
 * Pure helpers for backfilling email_messages.to_emails / cc from stored headers.
 */

export function trimAddress(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^"+|"+$/g, '').trim();
}

export function dedupeEmails(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = trimAddress(raw);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Extract email addresses from a mailparser-style header text value.
 * Handles `Name <a@b.com>, c@d.com` and bare addresses. Preserves left-to-right order.
 */
export function extractEmailsFromHeaderText(raw: string | null | undefined): string[] {
  const text = trimAddress(raw);
  if (!text) return [];

  const parts = text.split(',');
  const found: string[] = [];
  for (const part of parts) {
    const angled = part.match(/<([^<>\s]+@[^<>\s]+)>/);
    if (angled?.[1]) {
      found.push(angled[1]);
      continue;
    }
    const bare = part.match(/[^\s<>]+@[^\s<>]+/);
    if (bare?.[0]) found.push(bare[0]);
  }
  return dedupeEmails(found);
}

export function headerText(
  headers: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return v.map((entry) => String(entry)).join(', ');
    }
    if (v != null) return String(v);
  }
  return null;
}

export type RecipientBackfillPlan = {
  toEmails: string[] | null;
  cc: string[] | null;
  changedToEmails: boolean;
  changedCc: boolean;
};

/**
 * Plan column updates for one message.
 * - Prefer parsed header To/Cc when present.
 * - Otherwise fill to_emails from primary to_email when still null.
 * - Never clear an already-populated column.
 */
export function planRecipientBackfill(input: {
  toEmail: string | null | undefined;
  toEmails: string[] | null | undefined;
  cc: string[] | null | undefined;
  headers: Record<string, unknown> | null | undefined;
}): RecipientBackfillPlan {
  const existingToEmails = dedupeEmails(input.toEmails ?? []);
  const existingCc = dedupeEmails(input.cc ?? []);

  const headerTo = extractEmailsFromHeaderText(headerText(input.headers, 'to'));
  const headerCc = extractEmailsFromHeaderText(headerText(input.headers, 'cc'));
  const fallbackTo = dedupeEmails([input.toEmail]);

  let nextToEmails: string[] | null =
    existingToEmails.length > 0 ? existingToEmails : null;
  if (!nextToEmails) {
    if (headerTo.length > 0) nextToEmails = headerTo;
    else if (fallbackTo.length > 0) nextToEmails = fallbackTo;
  }

  let nextCc: string[] | null = existingCc.length > 0 ? existingCc : null;
  if (!nextCc && headerCc.length > 0) {
    nextCc = headerCc;
  }

  const changedToEmails =
    JSON.stringify(existingToEmails) !== JSON.stringify(nextToEmails ?? []);
  const changedCc = JSON.stringify(existingCc) !== JSON.stringify(nextCc ?? []);

  return {
    toEmails: nextToEmails,
    cc: nextCc,
    changedToEmails: changedToEmails && (nextToEmails?.length ?? 0) > 0,
    changedCc: changedCc && (nextCc?.length ?? 0) > 0,
  };
}
