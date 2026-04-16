import type { FloridaEntityDetailParsed, FloridaPersonRole } from './types.js';

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

function parseTitleNameSection(sectionHtml: string, source: FloridaPersonRole['source']): FloridaPersonRole[] {
  const re = /<span>Title&nbsp;([^<]+)<\/span>\s*<br>\s*<br>\s*([^<\n\r]+?)\s*<span>/gi;
  const out: FloridaPersonRole[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sectionHtml)) !== null) {
    const title = m[1].trim();
    let name = m[2].trim().replace(/\s+/g, ' ');
    name = name.replace(/\s*\(ASST\.?\)\s*$/i, '').trim();
    if (title && name) out.push({ title, name, source });
  }
  return out;
}

function extractBeforeAnnualReports(html: string, sectionTitle: string): string | null {
  const esc = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<span>${esc}<\\/span>([\\s\\S]*?)<div class="detailSection">\\s*<span>Annual Reports`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function parseRegisteredAgentName(html: string): string | undefined {
  const m = html.match(
    /<span>Registered Agent Name &amp; Address<\/span>\s*<span>([^<]+)<\/span>/i,
  );
  if (!m) return undefined;
  return stripTags(m[1]);
}

/**
 * Parse Sunbiz `SearchResultDetail` HTML (LLC authorized persons, corp officers, registered agent).
 */
export function parseFloridaEntityDetailHtml(html: string): FloridaEntityDetailParsed | null {
  const corpMatch = html.match(
    /class="detailSection corporationName"[^>]*>[\s\S]*?<p>([^<]+)<\/p>\s*<p>([^<]+)<\/p>/i,
  );
  if (!corpMatch) return null;

  const entityTypeLabel = stripTags(corpMatch[1]);
  const entityName = stripTags(corpMatch[2]);

  const docMatch = html.match(
    /<label for="Detail_DocumentId">Document Number<\/label><span>([^<]+)<\/span>/i,
  );
  const statusMatch = html.match(/<label for="Detail_Status">Status<\/label><span>([^<]+)<\/span>/i);

  const people: FloridaPersonRole[] = [];
  const auth = extractBeforeAnnualReports(html, 'Authorized Person(s) Detail');
  if (auth) people.push(...parseTitleNameSection(auth, 'authorized_person'));
  const off = extractBeforeAnnualReports(html, 'Officer/Director Detail');
  if (off) people.push(...parseTitleNameSection(off, 'officer'));

  return {
    documentNumber: docMatch ? stripTags(docMatch[1]) : '',
    entityName,
    entityTypeLabel,
    status: statusMatch ? stripTags(statusMatch[1]) : undefined,
    registeredAgentName: parseRegisteredAgentName(html),
    people,
  };
}
