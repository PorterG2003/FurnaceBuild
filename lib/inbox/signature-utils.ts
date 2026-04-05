import { processSpintax, stripSignatureStyles } from '@/lib/email/index';

/**
 * Convert a mailbox signature (HTML from rich editor) to an HTML block suitable for
 * injecting into the rich-text composer. No wrapper styling; only formatting HTML
 * (e.g. br, b, i) is preserved (style/class stripped). Spintax `{a|b}` is resolved
 * here so the composed reply matches campaign sends (see buildCampaignEmailContent).
 *
 * Returns an empty string when signature is null/empty so callers can
 * concatenate without branching.
 */
export function signatureToHtml(signature: string | null | undefined): string {
  if (!signature || !signature.trim()) return '';
  const stripped = stripSignatureStyles(signature.trim());
  return processSpintax(stripped);
}

/**
 * Append a plain-text signature to a plain-text email body.
 * Returns the body unchanged when signature is empty.
 */
export function appendSignatureText(body: string, signature: string | null | undefined): string {
  if (!signature || !signature.trim()) return body;
  return `${body}\n\n-- \n${signature}`;
}
