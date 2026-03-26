import { normalizePersonName } from '../scrapers/normalizeNames.js';
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

const LAWYER_TITLE_RE = /attorney|counsel/i;
const LAWYER_NAME_RE =
  /\b(P\.?\s*A\.?|L\.L\.P\.|LLP|ATTORNEYS?\b|ATTORNEY\b|AT\s+LAW|LAW\s+(OFFICES?|FIRM|GROUP)|\bESQ\b)/i;
const STATUTORY_AGENT_RE =
  /\b(CORPORATION\s+SERVICE|CSC-?|CT\s+CORPORATION|REGISTERED\s+AGENTS?\b|INCORP\s+SERVICES|LEGALINC|ZOOM|NW\s+REGISTERED|UNITED\s+AGENT|URS\s+AGENTS?|PRESTIGE\s+LEGAL)\b/i;

function isLawyerContext(name: string, title: string): boolean {
  if (LAWYER_TITLE_RE.test(title)) return true;
  return LAWYER_NAME_RE.test(name);
}

function isCorporateStatutoryAgent(name: string): boolean {
  const u = name.toUpperCase();
  if (STATUTORY_AGENT_RE.test(u)) return true;
  if (/\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION)\b/.test(u)) return true;
  return false;
}

function shouldUseRegisteredIndividual(name: string): boolean {
  const t = name.trim();
  if (t.length < 3) return false;
  if (/,\s*[A-Za-z]/.test(t)) return true;
  const parts = normalizePersonName(t).split(' ').filter((x) => x.length > 1);
  return parts.length >= 2;
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = normalizePersonName(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n.trim());
  }
  return out;
}

/**
 * Owner-like names for enrichment: officers / authorized persons, plus individual registered agents.
 * Drops obvious law-firm and statutory filing shops.
 */
export function filterFloridaOwnerPeople(detail: FloridaEntityDetailParsed): string[] {
  const fromOffices = detail.people.filter((p) => p.source !== 'registered_agent');
  let names = dedupeNames(
    fromOffices.filter((p) => !isLawyerContext(p.name, p.title)).map((p) => p.name.trim()),
  );

  if (names.length === 0) {
    names = dedupeNames(fromOffices.map((p) => p.name.trim()));
  }

  const ra = detail.registeredAgentName?.trim();
  if (ra && !isCorporateStatutoryAgent(ra) && !isLawyerContext(ra, 'Registered Agent')) {
    if (shouldUseRegisteredIndividual(ra)) {
      const raNorm = normalizePersonName(ra);
      if (!names.some((n) => normalizePersonName(n) === raNorm)) {
        names.push(ra);
      }
    }
  }

  return names;
}
