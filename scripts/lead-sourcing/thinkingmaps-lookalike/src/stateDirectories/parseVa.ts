import { blankRow, hasPersonName, splitPersonName } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVa(html: string): ParseResult {
  const rows: StateDirectoryRow[] = [];
  let district = '';
  const chunks = html.split(/<tr\b/i);
  for (const chunk of chunks) {
    const districtTitle = chunk.match(/class="division"[^>]*>[\s\S]*?title='([^']+)'/i);
    if (districtTitle?.[1] && /school/i.test(districtTitle[1])) {
      district = districtTitle[1].trim();
    }
    const schoolMatch = chunk.match(/<strong>([^<]+)<\/strong>/i);
    if (!schoolMatch) continue;
    const cells = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] ?? '');
    if (cells.length < 2) continue;
    const schoolCell = stripTags(cells[0] ?? '');
    const principal = stripTags(cells[1] ?? '');
    if (!principal || /position vacant|n\/a|tbd/i.test(principal)) continue;
const cityZip = schoolCell.match(
    /\b(?:rd|road|dr|drive|st|street|ave|avenue|blvd|ln|lane|way|hwy|highway|cir|ct|court|pl|place)\.?\s+([A-Za-z .'-]+),\s*VA\s+(\d{5})/i,
  );
  const zipOnly = schoolCell.match(/VA\s+(\d{5})/i);
    const name = splitPersonName(principal);
    const row = blankRow('VA');
    row.district_name = district;
    row.school_name = schoolMatch[1]!.trim();
    row.city = (cityZip?.[1] ?? '').trim();
    row.zip = cityZip?.[2] ?? zipOnly?.[1] ?? '';
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = 'Principal';
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
