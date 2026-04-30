/**
 * Sanitize stored email bodies for embedding inside an outbound forward HTML block.
 * Keeps quoted thread content (unlike getDisplayBody); strips scripts and cid: images.
 */
import { sanitizeEmailBody } from './sanitize-body.js';

export function stripScriptsFromEmailHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Remove img tags that reference cid: — they will not resolve on the recipient's client. */
export function stripUnresolvableCidImages(html: string): string {
  const cidImgPattern = /<img\b[^>]*\bsrc\s*=\s*['"]?cid:[^'">\s]+['"]?[^>]*>/gi;
  return html.replace(cidImgPattern, '');
}

export function sanitizeEmailHtmlForForwardEmbed(html: string | null | undefined): string {
  const raw = html ?? '';
  let out = sanitizeEmailBody(raw, { format: 'html' });
  out = stripScriptsFromEmailHtml(out);
  out = stripUnresolvableCidImages(out);
  return out;
}

function escapeHtmlForForwardText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text body → safe HTML fragment (newlines → br). */
export function plainTextEmailBodyToForwardHtml(text: string | null | undefined): string {
  const sanitized = sanitizeEmailBody(text ?? '', { format: 'text' });
  return escapeHtmlForForwardText(sanitized).replace(/\n/g, '<br>');
}
