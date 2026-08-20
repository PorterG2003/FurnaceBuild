import { processSpintax } from '../email/processSpintax';
import { sha256Hex } from '../utils/sha256Hex';

const MERGE_TAG_PATTERN = /\{\{[\s\S]*?\}\}/g;
const HTML_TAG_PATTERN = /<[^>]+>/g;

/** Collapse formatting differences while preserving spintax and merge tags. */
export function normalizeCopyWhitespace(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a verbatim piece for identity. Different merge-field names are
 * intentionally equivalent, while the complete spintax template is retained.
 */
export function normalizeCopyForFingerprint(value: string | null | undefined): string {
  return normalizeCopyWhitespace(value).replace(MERGE_TAG_PATTERN, '{{merge}}');
}

export async function copyPieceFingerprint(value: string): Promise<string> {
  return sha256Hex(normalizeCopyForFingerprint(value));
}

/**
 * Produce readable table text without pretending a specific lead's merge
 * values or random spintax branch was sent.
 */
export function renderCopyDisplayText(value: string | null | undefined): string {
  const raw = String(value ?? '');
  if (!raw) return '';

  const deterministic = processSpintax(raw, { deterministic: true });
  const withoutTemplateSyntax = deterministic
    .replace(MERGE_TAG_PATTERN, '')
    .replace(HTML_TAG_PATTERN, ' ')
    // Salvage a truncated spintax group by keeping its first branch.
    .split('|')[0]!
    .replace(/[{}]/g, '');

  return normalizeCopyWhitespace(withoutTemplateSyntax).replace(/\s+([,.;:!?])/g, '$1');
}

export function isVerbatimCopySpan(span: string, source: string): boolean {
  const normalizedSpan = normalizeCopyWhitespace(span);
  if (!normalizedSpan) return false;
  return normalizeCopyWhitespace(source).includes(normalizedSpan);
}
