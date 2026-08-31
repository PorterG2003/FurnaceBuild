const ENTITY_DECODE: Array<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&quot;/gi, '"'],
  [/&#39;/g, "'"],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
];

export function decodeEntities(text: string): string {
  let out = text;
  for (const [re, value] of ENTITY_DECODE) out = out.replace(re, value);
  return out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return collapseWhitespace(decodeEntities(stripped));
}

export function extractTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return collapseWhitespace(decodeEntities(title));
  return '';
}

export function hasForm(html: string): boolean {
  return /<form\b/i.test(html) || /<input\b[^>]*type=["']email/i.test(html);
}

export function extractLinks(html: string, baseUrl?: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = resolveUrl(match[1].trim(), baseUrl);
    const text = collapseWhitespace(decodeEntities(match[2].replace(/<[^>]+>/g, ' ')));
    if (href) links.push({ href, text });
  }
  return links;
}

export function resolveUrl(href: string, baseUrl?: string): string {
  if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function extractAddressCandidate(text: string): string | null {
  const match = text.match(
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,6}\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|way|ct|court|pkwy|parkway|cir|circle)\b[^,]{0,40},\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/i,
  );
  return match ? collapseWhitespace(match[0]) : null;
}
