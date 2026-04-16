import type { IowaEntityDetailParsed, IowaOfficerRow } from './types.js';

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractLabelValueRows(tableHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const chunks = [...row.matchAll(/<(th|td)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
    for (let i = 0; i < chunks.length; i += 1) {
      const tag = chunks[i][1].toLowerCase();
      if (tag !== 'th') continue;
      const label = stripTags(chunks[i][2]);
      const next = chunks[i + 1];
      if (next && next[1].toLowerCase() === 'td') {
        out[label] = stripTags(next[2]);
        i += 1;
      }
    }
  }
  return out;
}

/** Live `summary.aspx` uses a full `<th>...</th>` row followed by a `<td>...</td>` data row. */
function extractThRowThenTdRowPairs(tableHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tbody = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbody ? tbody[1] : tableHtml;
  const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((x) => x[1]);
  for (let i = 0; i < trs.length - 1; i++) {
    const r1 = trs[i];
    const r2 = trs[i + 1];
    if (!r1 || !r2) continue;
    if (!/<th\b/i.test(r1) || /<td\b/i.test(r1)) continue;
    if (!/<td\b/i.test(r2) || /<th\b/i.test(r2)) continue;
    if ([...r1.matchAll(/<td\b/gi)].length > 0) continue;
    const labels = [...r1.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => stripTags(x[1]));
    const values = [...r2.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (labels.length > 0 && labels.length === values.length) {
      for (let j = 0; j < labels.length; j++) {
        out[labels[j]!] = values[j] ?? '';
      }
      i++;
    }
  }
  return out;
}

function findOverviewTable(html: string): string | null {
  const byId = html.match(/<table[^>]*id=["'][^"']*tblSummary["'][^>]*>[\s\S]*?<\/table>/i);
  if (byId) return byId[0];
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    if (/Business No\.?/i.test(t[0]) && /Legal Name/i.test(t[0]) && /Status/i.test(t[0])) {
      return t[0];
    }
  }
  return null;
}

function parseNamesLegalType(html: string): { nameType?: string; legalNameFromNames?: string } {
  const namesBlock = html.match(/<table[^>]*id=["'][^"']*gvNames["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!namesBlock) return {};
  const tbody = namesBlock[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbody ? tbody[1] : namesBlock[1];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) {
    if (/<th\b/i.test(m[1])) continue;
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length < 4) continue;
    const nameType = cells[0];
    const name = cells[3];
    if ((/^L$/i.test(nameType) || /^legal$/i.test(nameType)) && name) {
      return { nameType, legalNameFromNames: name };
    }
  }
  return {};
}

function sectionAfterHeading(html: string, heading: string): string | null {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<h[12][^>]*>\\s*${esc}[\\s\\S]*?<\\/h[12]>\\s*([\\s\\S]*?)(?:<h[12]|<\\/body>|$)`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function parseRegisteredAgent(html: string): string | undefined {
  const block = sectionAfterHeading(html, 'Registered Agent or Reserving Party');
  if (!block) return undefined;
  const rows = [...block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((x) => x[1]);
  for (const row of rows) {
    if (/Full Name/i.test(row)) {
      const td = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (td && !/Address/i.test(stripTags(td[1]))) {
        const name = stripTags(td[1]);
        if (name) return name;
      }
      continue;
    }
    const soloTd = row.match(/^\s*<td[^>]*>([\s\S]*?)<\/td>\s*$/i);
    if (soloTd && !/Address|City/i.test(row)) {
      const name = stripTags(soloTd[1]);
      if (name && name.length > 2) return name;
    }
  }
  return undefined;
}

function parsePrincipalOfficeLine(html: string): string | undefined {
  const block = sectionAfterHeading(html, 'Principal Office');
  if (!block) return undefined;
  const lines: string[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    const row = m[1];
    if (/Full Name/i.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length >= 2 && /^Address$/i.test(cells[0] ?? '')) {
      const rest = cells.slice(1).filter((c) => c && !/^Address 2$/i.test(c));
      if (rest.length) lines.push(rest.join(', '));
    }
    if (cells.length >= 2 && /^City, State, Zip$/i.test(cells[0] ?? '') && cells[1]) {
      lines.push(cells[1]);
    }
  }
  const joined = lines.join(' — ').replace(/\s+/g, ' ').trim();
  return joined || undefined;
}

/**
 * Parse Iowa `summary.aspx` (or equivalent) HTML.
 */
export function parseIowaSummaryHtml(html: string): Partial<IowaEntityDetailParsed> | null {
  const table = findOverviewTable(html);
  if (!table) return null;

  const lv = { ...extractThRowThenTdRowPairs(table), ...extractLabelValueRows(table) };
  const names = parseNamesLegalType(html);

  const businessNumber = lv['Business No.'] ?? lv['Business No'] ?? '';
  const legalName = lv['Legal Name'] ?? names.legalNameFromNames ?? '';

  if (!businessNumber && !legalName) return null;

  return {
    businessNumber: businessNumber || '',
    legalName: legalName || '',
    status: lv['Status'] || undefined,
    entityType: lv['Type'] || undefined,
    nameType: names.nameType,
    stateOfIncorporation: lv['State of Inc.'] ?? lv['State of Inc'] ?? undefined,
    chapter: lv['Chapter'] || undefined,
    registeredAgentName: parseRegisteredAgent(html),
    principalOfficeLine: parsePrincipalOfficeLine(html),
    officers: [],
  };
}

function findOfficersTable(html: string): string | null {
  const byId = html.match(/id=["'][^"']*gvOfficers["'][^>]*>([\s\S]*?)<\/table>/i);
  if (byId) return byId[0];
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    if (/\bDirector\b/i.test(t[0]) && /\bAddress1\b/i.test(t[0]) && /\bName\b/i.test(t[0])) {
      return t[0];
    }
  }
  return null;
}

/**
 * Parse Iowa `officers.aspx` officer grid.
 */
export function parseIowaOfficersHtml(html: string): IowaOfficerRow[] {
  const table = findOfficersTable(html);
  if (!table) return [];

  const headerRow = table.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const headerText = headerRow ? stripTags(headerRow[1]).toLowerCase() : '';
  const expect =
    headerText.includes('name') &&
    headerText.includes('address1') &&
    headerText.includes('director') &&
    headerText.includes('type');
  if (!expect && !/\bAddress1\b/i.test(table)) return [];

  const tbody = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbody ? tbody[1] : table;

  const officers: IowaOfficerRow[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) {
    const row = m[1];
    if (/<th\b/i.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
    if (cells.length < 8) continue;
    officers.push({
      name: cells[0] ?? '',
      address1: cells[1] ?? '',
      address2: cells[2] ?? '',
      city: cells[3] ?? '',
      state: cells[4] ?? '',
      zip: cells[5] ?? '',
      officerType: cells[6] ?? '',
      directorFlag: cells[7] ?? '',
    });
  }
  return officers;
}

function parseOfficersHeadingMeta(html: string): { legalName?: string; businessNumber?: string } {
  const h2re = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = h2re.exec(html)) !== null) {
    if (/visually-hidden/i.test(m[1])) continue;
    const inner = stripTags(m[2]);
    const numM = inner.match(/\((\d+)\)\s*$/);
    const nameM = inner.match(/^(.+?)\s*\(\d+\)\s*$/);
    if (numM && nameM) {
      return { businessNumber: numM[1], legalName: nameM[1].trim() };
    }
  }
  return {};
}

/**
 * Merge Iowa **summary** and **officers** HTML into one detail object for persistence.
 */
export function parseIowaEntityDetailHtml(summaryHtml: string, officersHtml: string): IowaEntityDetailParsed | null {
  const summary = parseIowaSummaryHtml(summaryHtml);
  const officers = parseIowaOfficersHtml(officersHtml);
  const head = parseOfficersHeadingMeta(officersHtml);

  const businessNumber =
    (summary?.businessNumber && summary.businessNumber.trim()) ||
    head.businessNumber ||
    '';
  const legalName =
    (summary?.legalName && summary.legalName.trim()) || head.legalName || '';

  if (!businessNumber && !legalName && officers.length === 0) {
    return null;
  }

  return {
    businessNumber,
    legalName,
    status: summary?.status,
    entityType: summary?.entityType,
    nameType: summary?.nameType,
    stateOfIncorporation: summary?.stateOfIncorporation,
    chapter: summary?.chapter,
    registeredAgentName: summary?.registeredAgentName,
    principalOfficeLine: summary?.principalOfficeLine,
    officers,
  };
}
