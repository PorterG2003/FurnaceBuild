/**
 * Plain-text preview for notifications: strip quoted replies / forwards / signatures.
 * Mirrors lib/email/parse-body.ts logic, plus inline "On … wrote:" when the body is one line.
 */

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUOTE_AND_SIGNATURE_PATTERNS: ReadonlyArray<RegExp> = [
  /^-{3,}\s*forwarded\s+message\s*-{3,}/im,
  /^begin\s+forwarded\s+message\s*:/im,
  /^-{5,}\s*forwarded\s+message\s*-{5,}/im,
  /^-{3,}\s*original\s+message\s*-{3,}/im,
  /^_{3,}\s*original\s+message\s*_{3,}/im,
  /^\s*from\s*:\s*.+@.+/im,
  /^\s*on\s+[\s\S]*?wrote\s*:\s*$/im,
  /^\s*--\s+$/m,
  /^\s*_{3,}\s*$/m,
  /^\s*-{3,}\s*$/m,
];

/** Gmail/Apple-style "On … wrote:" mid-line (common when newlines are collapsed). */
const INLINE_ON_WROTE = /\sOn\s+[\s\S]+?wrote:\s*/i;

const SENT_FROM_LINE_PATTERN =
  /^\s*(sent\s+from\s+my\s+|get\s+outlook\s+for|get\s+outlook\s+free|________________________________|sent\s+from\s+mail\s+for)/im;

function findLineAnchoredQuoteIndex(text: string): number {
  let earliest = -1;
  for (const pattern of QUOTE_AND_SIGNATURE_PATTERNS) {
    const m = text.match(pattern);
    if (m?.index != null && m.index >= 0) {
      if (earliest === -1 || m.index < earliest) earliest = m.index;
    }
  }
  return earliest;
}

function findInlineOnWroteIndex(text: string): number {
  const m = text.match(INLINE_ON_WROTE);
  if (m?.index == null || m.index < 0) return -1;
  return m.index;
}

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
 * First paragraph / line of new content only (no sender prefix in body).
 */
export function previewNewMessagePlainText(
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined
): string {
  const rawText = bodyText?.trim();
  const rawHtml = bodyHtml?.trim();

  let text: string;
  let usedHtml = false;
  if (rawText) {
    text = rawText;
  } else if (rawHtml) {
    text = stripHtml(rawHtml);
    usedHtml = true;
  } else {
    return '';
  }

  if (usedHtml && rawHtml) {
    const fromBlockquotes = stripHtml(rawHtml.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' '));
    if (fromBlockquotes.trim()) {
      text = fromBlockquotes;
    }
  }

  let cut = findLineAnchoredQuoteIndex(text);
  const inline = findInlineOnWroteIndex(text);
  if (inline >= 0 && (cut < 0 || inline < cut)) {
    cut = inline;
  }

  const sentFrom = sentFromCutIndex(text);
  if (sentFrom >= 0 && (cut < 0 || sentFrom < cut)) {
    cut = sentFrom;
  }

  if (cut >= 0) {
    text = text.slice(0, cut);
  }

  text = normalizeWhitespace(text);

  const firstPara = text.split(/\n\n+/)[0] ?? text;
  const firstLine = firstPara.split(/\n/)[0] ?? firstPara;

  let line = firstLine.trim();
  line = line.replace(/^>\s*/g, '').trim();
  line = line.replace(/\s+>/g, ' ').trim();

  return line;
}
