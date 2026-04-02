import type { FloridaSearchHit } from './types.js';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse Sunbiz `#search-results` entity name table (after POST search).
 */
export function parseFloridaSearchResultsHtml(html: string): FloridaSearchHit[] {
  const block = html.match(/id=["']search-results["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!block) return [];

  const hits: FloridaSearchHit[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  const body = block[1];

  while ((m = rowRe.exec(body)) !== null) {
    const row = m[1];
    const linkMatch = row.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    // href attributes use &amp;; must decode before building a URL or query params collapse into one key.
    const detailHref = decodeEntities(linkMatch[1].trim());
    const entityName = stripTags(linkMatch[2]);
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length < 3) continue;

    const documentNumber = cells[1] ?? '';
    const status = cells[2] ?? '';

    hits.push({
      entityName,
      documentNumber,
      status,
      detailHref,
    });
  }

  return hits;
}
