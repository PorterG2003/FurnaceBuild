/**
 * Strip style and class attributes from HTML so signatures use only formatting
 * (e.g. <br>, <b>, <i>) and not styling. Used when building campaign content
 * and when rendering signatures in the inbox composer.
 */
export function stripSignatureStyles(html: string | null | undefined): string {
  if (html == null) return '';
  let out = html.trim();
  if (!out) return '';

  // Remove style="..." or style='...'
  out = out.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
  // Remove class="..." or class='...'
  out = out.replace(/\s*class\s*=\s*["'][^"']*["']/gi, '');

  return out;
}
