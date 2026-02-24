/**
 * Convert a mailbox signature (HTML from rich editor) to an HTML block suitable for
 * injecting into the rich-text composer or appending to campaign emails.
 * The value is already HTML; we wrap it in the signature div without escaping.
 *
 * Returns an empty string when signature is null/empty so callers can
 * concatenate without branching.
 */
export function signatureToHtml(signature: string | null | undefined): string {
  if (!signature || !signature.trim()) return '';

  return `<div class="email-signature" style="margin-top:16px;padding-top:8px;border-top:1px solid #ccc;color:#888;font-size:14px;">${signature.trim()}</div>`;
}

/**
 * Append a plain-text signature to a plain-text email body.
 * Returns the body unchanged when signature is empty.
 */
export function appendSignatureText(body: string, signature: string | null | undefined): string {
  if (!signature || !signature.trim()) return body;
  return `${body}\n\n-- \n${signature}`;
}
