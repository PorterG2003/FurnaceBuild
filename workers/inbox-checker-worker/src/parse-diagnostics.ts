/**
 * Structured parse logging for every IMAP message (sender vs Message-ID vs threading headers).
 * Suspicious heuristics use console.warn; otherwise log only when sampled
 * (controlled by INBOX_PARSE_DEBUG_SAMPLE_RATE, default 0 = no debug output).
 */

/** FNV-1a 32-bit hash used for deterministic message-ID sampling. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

function parseSampleRate(raw: string | undefined): number {
  const v = parseFloat(raw ?? '0');
  if (Number.isNaN(v) || v < 0) return 0;
  return Math.min(v, 1);
}

/**
 * Deterministic sample decision for a message ID.
 * Returns true when the message should have its diagnostics logged.
 */
export function shouldSampleMessage(messageId: string | null | undefined): boolean {
  const rate = parseSampleRate(process.env.INBOX_PARSE_DEBUG_SAMPLE_RATE);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const id = messageId ?? String(Math.random()); // non-deterministic fallback when no ID
  return (fnv1a32(id) / 4294967296) < rate;
}

export type AddressHeaderShape = { value?: Array<{ address?: string; name?: string }> } | undefined;

function getHeaderCi(
  headers: Record<string, string | string[]>,
  name: string
): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (Array.isArray(v)) return v[0] ?? null;
      return v ?? null;
    }
  }
  return null;
}

function normalizeMessageIdToken(id: string | null | undefined): string | null {
  if (!id) return null;
  const t = id.trim().replace(/^<|>$/g, '').toLowerCase();
  return t || null;
}

function localPart(addr: string): string {
  const a = addr.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  return at === -1 ? a : a.slice(0, at);
}

function domainPart(addr: string): string {
  const a = addr.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  return at === -1 ? '' : a.slice(at + 1);
}

export function formatAddressList(addr: AddressHeaderShape): string[] {
  if (!addr?.value?.length) return [];
  return addr.value
    .map((v) => (v.address || '').trim())
    .filter(Boolean);
}

export type ParseDiagnosticsInput = {
  mailboxId: string;
  mailboxEmail: string;
  imapUid: number;
  subject: string;
  /** Parsed From (first mailbox) */
  fromAddress: string;
  fromName?: string;
  replyTo: AddressHeaderShape;
  sender: AddressHeaderShape;
  messageId: string | null;
  inReplyTo: string | null;
  referencesRaw: string | null;
  referencesTokenCount: number;
  returnPath: string | null;
};

export function countReferenceTokens(references: string | null): number {
  if (!references?.trim()) return 0;
  return references
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^<|>$/g, ''))
    .filter(Boolean).length;
}

/**
 * Heuristics for addresses that look like Gmail Message-ID / routing ids, not human mailboxes.
 */
export function evaluateSuspiciousSender(input: {
  fromAddress: string;
  messageId: string | null;
}): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const from = input.fromAddress.trim().toLowerCase();
  const normMid = normalizeMessageIdToken(input.messageId);

  if (!from && normMid) {
    reasons.push('empty_from_with_message_id');
  }

  if (from && domainPart(from) === 'mail.gmail.com') {
    reasons.push('from_domain_is_mail_gmail_com');
    const lp = localPart(from);
    if (/[=+]/.test(lp) || lp.length > 40 || /_/.test(lp)) {
      reasons.push('from_local_part_looks_like_gmail_routing_id');
    }
  }

  if (from && normMid) {
    const midLocal = localPart(normMid);
    const fromLocal = localPart(from);
    if (midLocal && fromLocal && midLocal === fromLocal) {
      reasons.push('from_local_part_matches_message_id_local_part');
    }
    if (normMid.includes('@') && from === normMid) {
      reasons.push('from_equals_full_message_id');
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}

/** One JSON line per parsed message (grep CloudWatch for `[INBOX PARSE]` or `inbox_parse`).
 * Emitted unconditionally when suspicious; otherwise only when sampled via
 * INBOX_PARSE_DEBUG_SAMPLE_RATE (default 0 → no routine debug output).
 */
export function logParseDiagnostics(input: ParseDiagnosticsInput): void {
  const replyToList = formatAddressList(input.replyTo);
  const senderList = formatAddressList(input.sender);
  const { suspicious, reasons } = evaluateSuspiciousSender({
    fromAddress: input.fromAddress,
    messageId: input.messageId,
  });

  // Always warn for suspicious; only log for non-suspicious when sampled
  if (!suspicious && !shouldSampleMessage(input.messageId)) {
    return;
  }

  const payload = {
    tag: 'inbox_parse',
    mailboxId: input.mailboxId,
    imapUid: input.imapUid,
    subjectPreview: (input.subject || '').slice(0, 120),
    from: input.fromAddress || null,
    fromName: input.fromName ?? null,
    replyTo: replyToList,
    sender: senderList,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
    referencesTokenCount: input.referencesTokenCount,
    referencesPreview: input.referencesRaw ? input.referencesRaw.slice(0, 200) : null,
    returnPath: input.returnPath,
    suspicious,
    suspiciousReasons: reasons,
  };

  const line = JSON.stringify(payload);
  if (suspicious) {
    console.warn(`[INBOX PARSE] ${line}`);
  } else {
    console.log(`[INBOX PARSE] ${line}`);
  }
}

export { getHeaderCi };
