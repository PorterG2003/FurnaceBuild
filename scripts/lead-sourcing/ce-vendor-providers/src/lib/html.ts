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

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return collapseWhitespace(decodeEntities(stripped));
}

/** Drop chrome so nav labels like "Webinars" do not count as delivery format. */
export function stripChromeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ');
}

export function pageBodyText(html: string): string {
  return htmlToText(stripChromeHtml(html));
}

export function isErrorPage(html: string): boolean {
  const title = extractTitle(html);
  return /\b404\b|\bpage not found\b|\berror 404\b/i.test(title);
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractMetaDescription(html: string): string {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return collapseWhitespace(decodeEntities(match[1]));
  }
  return '';
}

/** Title + meta + stripped lead copy — what the company says it is, not nav/footer. */
export function pageHeadline(html: string, title?: string): string {
  const head = title?.trim() || extractTitle(html);
  const meta = extractMetaDescription(html);
  const lead = pageBodyText(html).slice(0, 1200);
  return collapseWhitespace(`${head} ${meta} ${lead}`).slice(0, 2500);
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

export function stripTags(html: string): string {
  return collapseWhitespace(decodeEntities(html.replace(/<[^>]+>/g, ' ')));
}
