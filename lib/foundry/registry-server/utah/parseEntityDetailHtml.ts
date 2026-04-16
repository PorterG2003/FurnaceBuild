import type { UtahEntityDetailParsed, UtahPrincipal } from './types.js';

function decodeEntities(html: string): string {
  return html
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
 * Parse Utah entity detail page HTML (BusinessInformation view).
 * Principals: table#grid_principalList
 */
export function parseEntityDetailHtml(html: string): UtahEntityDetailParsed | null {
  const entityNameMatch = html.match(
    /Entity Name:<\/label>[\s\S]*?<div class="col-sm-3[^"]*">\s*([^<]+)/i,
  );
  const entityNumMatch = html.match(
    /Entity Number:<\/label>[\s\S]*?<div class="col-sm-3[^"]*">\s*([^<]+)/i,
  );
  const entityStatusMatch = html.match(
    /Entity Status:<\/label>[\s\S]*?<div class="col-sm-3[^"]*">\s*([^<]+)/i,
  );

  const gridMatch = html.match(
    /<table[^>]*id=["']grid_principalList["'][^>]*>([\s\S]*?)<\/table>/i,
  );
  if (!gridMatch) {
    return null;
  }

  const tbodyMatch = gridMatch[1].match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const body = tbodyMatch ? tbodyMatch[1] : gridMatch[1];
  const principals: UtahPrincipal[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) {
    const row = m[1];
    if (/<th/i.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length >= 4) {
      principals.push({
        title: cells[0],
        name: cells[1],
        address: cells[2],
        lastUpdated: cells[3],
      });
    }
  }

  return {
    entityNumber: entityNumMatch ? stripTags(entityNumMatch[1]) : '',
    entityName: entityNameMatch ? stripTags(entityNameMatch[1]) : '',
    entityStatus: entityStatusMatch ? stripTags(entityStatusMatch[1]) : undefined,
    principals,
  };
}

const OWNER_LIKE_TITLES = new Set(['member', 'manager', 'authorized person', 'managing member']);

/** True when the principal’s title is member / manager / authorized person (not RA-only). */
export function utahPrincipalTitleIsMemberLike(principal: UtahPrincipal): boolean {
  return OWNER_LIKE_TITLES.has(principal.title.trim().toLowerCase());
}

/** Principals treated as owner-like for CSV comparison (Utah often lists Manager). */
export function filterMemberPrincipals(principals: UtahPrincipal[]): UtahPrincipal[] {
  const owners = principals.filter((p) => OWNER_LIKE_TITLES.has(p.title.trim().toLowerCase()));
  return owners.length > 0 ? owners : principals;
}
