import type { IowaSearchHit } from './types.js';

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

function isResultsTableFragment(tableHtml: string): boolean {
  return (
    /Business No\.?/i.test(tableHtml) &&
    /\bName\b/i.test(tableHtml) &&
    /\bStatus\b/i.test(tableHtml) &&
    /\bType\b/i.test(tableHtml)
  );
}

function findSearchResultsTable(html: string): string | null {
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const full = m[0];
    if (isResultsTableFragment(full)) return full;
  }
  return null;
}

function headerCellTexts(tableHtml: string): string[] {
  const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (thead) {
    return [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => stripTags(x[1]));
  }
  // Iowa live `results.aspx` uses a header row inside `<tbody>` (no `<thead>`).
  const tbody = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbody) {
    const firstRow = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (firstRow && /<th\b/i.test(firstRow[1])) {
      return [...firstRow[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => stripTags(x[1]));
    }
  }
  const beforeBody = tableHtml.split(/<tbody/i)[0] ?? tableHtml;
  return [...beforeBody.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => stripTags(x[1]));
}

function mapColumnIndices(headers: string[]): { num: number; name: number; status: number; type: number } | null {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const idx = (label: RegExp) => norm.findIndex((h) => label.test(h));
  const num = idx(/^business no\.?$/i);
  const name = idx(/^name$/i);
  const status = idx(/^status$/i);
  const type = idx(/^type$/i);
  if (num < 0 || name < 0 || status < 0 || type < 0) return null;
  return { num, name, status, type };
}

/**
 * Parse Iowa business search results HTML into structured hits.
 */
export function parseIowaSearchResultsHtml(html: string): IowaSearchHit[] {
  const table = findSearchResultsTable(html);
  if (!table) return [];

  const headers = headerCellTexts(table);
  const col = mapColumnIndices(headers);
  if (!col) return [];

  const tbody = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbody ? tbody[1] : table;

  const hits: IowaSearchHit[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body)) !== null) {
    const row = rm[1];
    if (/<th\b/i.test(row)) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    if (cells.length <= Math.max(col.num, col.name, col.status, col.type)) continue;

    const numCell = cells[col.num] ?? '';
    const link = numCell.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const businessNumber = link ? stripTags(link[2]) : stripTags(numCell);
    const summaryHref = link ? decodeEntities(link[1].trim()) : undefined;

    hits.push({
      businessNumber,
      entityName: stripTags(cells[col.name] ?? ''),
      status: stripTags(cells[col.status] ?? ''),
      nameType: stripTags(cells[col.type] ?? ''),
      summaryHref,
    });
  }

  return hits;
}
