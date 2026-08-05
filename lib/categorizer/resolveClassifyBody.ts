import { getDisplayBody } from '../email/index';

/** When quote/signature strip empties the body, keep this many raw chars as fallback. */
export const CLASSIFY_BODY_RAW_PREFIX_LIMIT = 500;

export type ClassifyBodySource = {
  body_text?: string | null;
  body_html?: string | null;
};

/**
 * Prefer stripped display body (body_text, else HTML→text). If strip leaves
 * empty while raw had content, fall back to a short unstripped prefix so the
 * model is not classifying from outbound alone on quote-only replies.
 */
export function resolveClassifyBody(source: ClassifyBodySource): string | null {
  const rawText = (source.body_text ?? '').trim();
  const rawHtml = (source.body_html ?? '').trim();
  const preferredRaw = rawText || rawHtml;
  if (!preferredRaw) return null;

  const format = rawText ? 'text' : 'html';
  const display = getDisplayBody(preferredRaw, { format }).trim();
  if (display) return display;

  const prefix =
    preferredRaw.length <= CLASSIFY_BODY_RAW_PREFIX_LIMIT
      ? preferredRaw
      : preferredRaw.slice(0, CLASSIFY_BODY_RAW_PREFIX_LIMIT);
  return prefix || null;
}
