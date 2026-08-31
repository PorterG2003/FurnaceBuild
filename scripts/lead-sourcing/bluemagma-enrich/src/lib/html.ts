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
  for (const [re, value] of ENTITY_DECODE) {
    out = out.replace(re, value);
  }
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
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return collapseWhitespace(decodeEntities(h1.replace(/<[^>]+>/g, ' ')));
  return '';
}

export type HrefLink = { href: string; text: string };

export function extractLinks(html: string, baseUrl?: string): HrefLink[] {
  const links: HrefLink[] = [];
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

export function snippetAround(text: string, needle: RegExp, radius = 90): string {
  const match = needle.exec(text);
  if (!match || match.index == null) return text.slice(0, radius * 2);
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return collapseWhitespace(text.slice(start, end));
}
