import type { UtahSearchHit } from './types.js';

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse Utah business search results table#grid_businessList (after AJAX fill).
 */
export function parseSearchResultsHtml(html: string): UtahSearchHit[] {
  const grid = html.match(/id=["']grid_businessList["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!grid) return [];

  const hits: UtahSearchHit[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  const body = grid[1];

  while ((m = rowRe.exec(body)) !== null) {
    const row = m[1];
    const idMatch = row.match(
      /GetBusinessSearchResultById\((?:&quot;|")(\d+)(?:&quot;|"),\s*(?:&quot;|")(\d+)(?:&quot;|")\)/,
    );
    if (!idMatch) continue;

    const linkMatch = row.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const entityName = linkMatch ? stripTags(linkMatch[1]) : '';

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length < 9) continue;

    const status = cells[2] ?? '';
    const entityType = cells[6] ?? '';
    const entityNumber = cells[8] ?? '';

    hits.push({
      businessId: idMatch[1],
      businessReservationNumber: idMatch[2],
      entityName,
      entityNumber,
      status,
      entityType,
    });
  }

  return hits;
}
