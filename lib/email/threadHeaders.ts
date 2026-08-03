/**
 * Shared RFC threading helpers for Message-ID / In-Reply-To / References,
 * stable submitted IDs, and thread-topic normalization.
 */

/** Default domain for Furnace-generated Message-IDs. */
export const DEFAULT_MESSAGE_ID_DOMAIN = 'furnace.build';

/** Soft cap for References header payload (bytes), preserving root + recent tail. */
export const DEFAULT_REFERENCES_MAX_BYTES = 2000;

const MESSAGE_ID_TOKEN_RE = /<[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+/g;

/**
 * Strip angle brackets and collapse whitespace. Lowercases for case-insensitive
 * RFC 5322 matching / storage. Returns null for empty/invalid.
 */
export function normalizeMessageId(messageId: string | null | undefined): string | null {
  if (messageId == null) return null;
  const trimmed = String(messageId).trim();
  if (!trimmed) return null;
  const unbracketed = trimmed.replace(/^<|>$/g, '').trim().toLowerCase();
  if (!unbracketed || !unbracketed.includes('@')) return null;
  return unbracketed;
}

/**
 * Format a Message-ID for SMTP wire headers (always bracketed).
 */
export function formatMessageId(messageId: string | null | undefined): string | null {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) return null;
  return `<${normalized}>`;
}

/**
 * Parse all Message-ID tokens from a string, array, or mixed References/In-Reply-To value.
 * Dedupes by normalized form while preserving first-seen order.
 */
export function parseMessageIds(
  value: string | string[] | null | undefined,
): string[] {
  if (value == null) return [];

  const chunks: string[] = Array.isArray(value)
    ? value.flatMap((part) => String(part ?? '').split(/\s+/))
    : String(value).split(/\s+/);

  const joined = chunks.join(' ');
  const matches = joined.match(MESSAGE_ID_TOKEN_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const normalized = normalizeMessageId(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

/**
 * Format a References / multi-ID header value as space-separated bracketed IDs.
 */
export function formatReferencesHeader(ids: Array<string | null | undefined>): string | null {
  const formatted = ids
    .map((id) => formatMessageId(id))
    .filter((id): id is string => Boolean(id));
  if (formatted.length === 0) return null;
  return formatted.join(' ');
}

export type BuildReplyThreadingHeadersInput = {
  /** Immediate parent Message-ID (required for threading). */
  parentMessageId: string | null | undefined;
  /** Parent's References ancestry (normalized or raw). */
  parentReferences?: string | string[] | null | undefined;
  /** Max bytes for the References header value (default DEFAULT_REFERENCES_MAX_BYTES). */
  maxBytes?: number;
};

export type ReplyThreadingHeaders = {
  inReplyTo: string;
  references: string;
  referenceMessageIds: string[];
};

/**
 * Build In-Reply-To = parent and References = parent.references + parent.
 * Caps References by byte length while keeping the root and the most recent tail.
 */
export function buildReplyThreadingHeaders(
  input: BuildReplyThreadingHeadersInput,
): ReplyThreadingHeaders | null {
  const parentId = normalizeMessageId(input.parentMessageId);
  if (!parentId) return null;

  const parentRefs = parseMessageIds(input.parentReferences ?? null);
  const withoutParent = parentRefs.filter((id) => id !== parentId);
  const fullChain = [...withoutParent, parentId];
  const capped = capReferenceChain(fullChain, input.maxBytes ?? DEFAULT_REFERENCES_MAX_BYTES);

  const inReplyTo = formatMessageId(parentId)!;
  const references = formatReferencesHeader(capped)!;
  return {
    inReplyTo,
    references,
    referenceMessageIds: capped,
  };
}

/**
 * Preserve root + as much of the recent tail as fits under maxBytes.
 */
export function capReferenceChain(ids: string[], maxBytes: number): string[] {
  if (ids.length === 0) return [];
  const formatted = ids.map((id) => formatMessageId(id)).filter((id): id is string => Boolean(id));
  if (formatted.length === 0) return [];

  const joined = () => formatted.join(' ');
  if (byteLength(joined()) <= maxBytes) {
    return formatted.map((id) => normalizeMessageId(id)!);
  }

  if (formatted.length === 1) {
    return [normalizeMessageId(formatted[0])!];
  }

  const root = formatted[0]!;
  const rest = formatted.slice(1);
  // Drop oldest after root until under budget.
  let start = 0;
  while (start < rest.length) {
    const candidate = [root, ...rest.slice(start)].join(' ');
    if (byteLength(candidate) <= maxBytes) {
      return [root, ...rest.slice(start)].map((id) => normalizeMessageId(id)!);
    }
    start += 1;
  }

  // Even root alone may exceed; still return root.
  return [normalizeMessageId(root)!];
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Stable Message-ID derived from a message-job UUID so retries reuse identity.
 */
export function buildStableSubmittedMessageId(
  messageJobId: string,
  domain: string = DEFAULT_MESSAGE_ID_DOMAIN,
): string {
  const id = String(messageJobId ?? '').trim().toLowerCase();
  const host = String(domain ?? DEFAULT_MESSAGE_ID_DOMAIN).trim().toLowerCase() || DEFAULT_MESSAGE_ID_DOMAIN;
  if (!id) {
    throw new Error('messageJobId is required for stable Message-ID');
  }
  return `<${id}@${host}>`;
}

/**
 * Normalize a thread topic (Outlook Thread-Topic / conversation key).
 * Strips common reply/forward prefixes; does not invent content.
 */
export function normalizeThreadTopic(subject: string | null | undefined): string | null {
  let s = String(subject ?? '').trim();
  if (!s) return null;

  // Strip repeated Re:/Fwd:/Fw: prefixes (case-insensitive, optional brackets).
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim();
    s = s.replace(/^\[\s*(?:re|fw|fwd)\s*\]\s*:?\s*/i, '').trim();
  }

  return s || null;
}

/**
 * Pick the best Message-ID to put on the wire / use as parent:
 * prefer transport-reported, fall back to submitted.
 */
export function pickWireMessageId(params: {
  providerMessageId?: string | null;
  submittedMessageId?: string | null;
}): string | null {
  return (
    normalizeMessageId(params.providerMessageId) ??
    normalizeMessageId(params.submittedMessageId)
  );
}

/**
 * Reconstruct cumulative References for a send given ordered ancestor wire IDs
 * (oldest → newest, excluding the current message).
 */
export function buildReferencesFromAncestorIds(
  ancestorIds: Array<string | null | undefined>,
  maxBytes: number = DEFAULT_REFERENCES_MAX_BYTES,
): { inReplyTo: string; references: string; referenceMessageIds: string[] } | null {
  const normalized = parseMessageIds(
    ancestorIds
      .map((id) => normalizeMessageId(id))
      .filter((id): id is string => Boolean(id))
      .join(' '),
  );
  if (normalized.length === 0) return null;

  const parentId = normalized[normalized.length - 1]!;
  return buildReplyThreadingHeaders({
    parentMessageId: parentId,
    parentReferences: normalized.slice(0, -1),
    maxBytes,
  });
}
