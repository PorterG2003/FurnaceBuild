/**
 * Email body parsing — strip quoted replies, forwarded content, and signatures
 * so the display shows only the "new" content (or the main message when viewing a thread).
 *
 * Handles:
 * - HTML → plain text (tag strip, whitespace collapse)
 * - Forwarded message blocks (Gmail, Apple Mail, etc.)
 * - Quoted reply blocks: "On ... wrote:", Outlook "From:/Sent:/To:/Subject:", "----- Original Message -----"
 * - RFC-style signature delimiter "-- "
 * - Common signature separators (___ , ---)
 *
 * Strategy: find the earliest start of any quoted/forwarded/signature block and truncate there.
 */
import { sanitizeEmailBody } from './sanitize-body';

export type ParseEmailBodyOptions = {
  /** Input format; if 'html', body is stripped to plain text first. Default 'text'. */
  format?: 'text' | 'html';
  /** If true, also strip content after common "Sent from ..." / "Get Outlook for" lines. Default true. */
  stripSentFromLines?: boolean;
  /** If true, normalize multiple newlines to at most 2. Default true. */
  normalizeWhitespace?: boolean;
};

export type ParsedEmailBody = {
  /** Body suitable for display (no quoted thread, no signature). */
  displayBody: string;
  /** Whether any quoted/forwarded/signature content was stripped. */
  hadQuotedOrSignatureContent: boolean;
};

const DEFAULT_OPTIONS: Required<ParseEmailBodyOptions> = {
  format: 'text',
  stripSentFromLines: true,
  normalizeWhitespace: true,
};

/**
 * Strip HTML tags and collapse whitespace to get plain text.
 * Safe to call with null/undefined (returns '').
 */
export function stripHtml(html: string | null | undefined): string {
  if (html == null || html === '') return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Patterns that indicate the start of quoted/forwarded content or signature.
 * We search for the earliest occurrence and truncate there.
 * Order of this array does not matter; we take the minimum index.
 */
const QUOTE_AND_SIGNATURE_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  // Forwarded message blocks (Gmail, Apple Mail, etc.)
  { pattern: /^-{3,}\s*forwarded\s+message\s*-{3,}/im, description: 'forwarded message block' },
  { pattern: /^begin\s+forwarded\s+message\s*:/im, description: 'begin forwarded message' },
  { pattern: /^-{5,}\s*forwarded\s+message\s*-{5,}/im, description: 'forwarded message (dashes)' },

  // Outlook / Windows Mail
  { pattern: /^-{3,}\s*original\s+message\s*-{3,}/im, description: 'original message' },
  { pattern: /^_{3,}\s*original\s+message\s*_{3,}/im, description: 'original message (underscores)' },
  // "From: ..." at line start (Outlook-style header block)
  { pattern: /^\s*from\s*:\s*.+@.+/im, description: 'From: line (Outlook)' },
  // "On ... wrote:" — multiline (date/name can wrap); single pattern for all variants
  { pattern: /^\s*on\s+[\s\S]*?wrote\s*:\s*$/im, description: 'On ... wrote:' },

  // RFC 2646 signature delimiter (two dashes + space + newline)
  { pattern: /^\s*--\s+$/m, description: 'signature delimiter -- ' },
  // Common signature separators
  { pattern: /^\s*_{3,}\s*$/m, description: 'signature ___' },
  { pattern: /^\s*-{3,}\s*$/m, description: 'signature ---' },
];

/**
 * "Sent from ..." / "Get Outlook for" type lines that often start a signature block.
 * Only used when stripSentFromLines is true; we look for these at line start.
 */
const SENT_FROM_LINE_PATTERN = /^\s*(sent\s+from\s+my\s+|get\s+outlook\s+for|get\s+outlook\s+free|________________________________|sent\s+from\s+mail\s+for)/im;

/**
 * Find the earliest index where any of the quote/signature patterns match.
 * Returns -1 if none match.
 */
function findEarliestQuoteOrSignatureIndex(text: string): number {
  let earliest = -1;
  for (const { pattern } of QUOTE_AND_SIGNATURE_PATTERNS) {
    const m = text.match(pattern);
    if (m?.index != null && m.index >= 0) {
      if (earliest === -1 || m.index < earliest) earliest = m.index;
    }
  }
  return earliest;
}

/**
 * If stripSentFromLines: find first line that looks like "Sent from my iPhone" etc.
 * and cut there (only if it's after some real content — e.g. not at start).
 */
function sentFromCutIndex(text: string): number {
  const m = text.match(SENT_FROM_LINE_PATTERN);
  if (m?.index == null || m.index < 0) return -1;
  return m.index;
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Parse an email body into display-ready plain text by removing quoted replies,
 * forwarded content, and signatures.
 *
 * @param body - Raw body (plain text or HTML depending on options.format)
 * @param options - Parse options (format, stripSentFromLines, normalizeWhitespace)
 * @returns ParsedEmailBody with displayBody and hadQuotedOrSignatureContent
 */
export function parseEmailBody(
  body: string | null | undefined,
  options: ParseEmailBodyOptions = {}
): ParsedEmailBody {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let text = sanitizeEmailBody(body ?? '', { format: opts.format });
  if (text === '') {
    return { displayBody: '', hadQuotedOrSignatureContent: false };
  }

  if (opts.format === 'html') {
    text = stripHtml(text);
  }

  const originalLength = text.length;
  let cut = findEarliestQuoteOrSignatureIndex(text);

  if (opts.stripSentFromLines) {
    const sentFrom = sentFromCutIndex(text);
    if (sentFrom >= 0 && (cut < 0 || sentFrom < cut)) {
      cut = sentFrom;
    }
  }

  if (cut >= 0) {
    text = text.slice(0, cut);
  }

  text = text.trim();
  if (opts.normalizeWhitespace) {
    text = normalizeWhitespace(text);
  }

  return {
    displayBody: text,
    hadQuotedOrSignatureContent: cut >= 0 || text.length < originalLength,
  };
}

/**
 * Convenience: get only the display body (no quoted/signature content).
 * Uses default options (format 'text', stripSentFromLines true, normalizeWhitespace true).
 */
export function getDisplayBody(
  body: string | null | undefined,
  options: Pick<ParseEmailBodyOptions, 'format'> = {}
): string {
  return parseEmailBody(body, options).displayBody;
}
