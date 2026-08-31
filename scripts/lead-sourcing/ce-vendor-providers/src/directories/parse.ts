import type { DirectoryEntry } from '../lib/types.js';
import { extractLinks, htmlToText, stripTags } from '../lib/html.js';
import { canonicalizeUrl, hostnameOf } from '../lib/url.js';

export type ParseContext = {
  source_directory: string;
  accreditor: string;
  audience_profession: string;
  source_url: string;
};

function normalizeWebsite(raw: string): string {
  const parts = raw
    .split(/[\n|,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[0] ?? '';
  if (!candidate) return '';
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate.replace(/^\/\//, '')}`;
  try {
    return canonicalizeUrl(withScheme);
  } catch {
    return withScheme;
  }
}

function entry(
  ctx: ParseContext,
  name: string,
  website: string,
): DirectoryEntry | null {
  const provider_name = name.replace(/\s+/g, ' ').trim();
  if (provider_name.length < 2) return null;
  if (isNavNoise(provider_name)) return null;
  return {
    provider_name,
    source_directory: ctx.source_directory,
    accreditor: ctx.accreditor,
    audience_profession: ctx.audience_profession,
    source_url: ctx.source_url,
    listed_website: website ? normalizeWebsite(website) : '',
  };
}

function websiteFromLink(href: string, pageUrl: string): string {
  if (!href) return '';
  try {
    const url = new URL(href, pageUrl);
    if (hostnameOf(url.toString()) === hostnameOf(pageUrl)) return '';
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.origin + '/';
  } catch {
    return '';
  }
}

/** NASBA sponsor-list: JSON-LD Organization blocks, then heading fallback. */
export function parseNasbaHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const fromLd: DirectoryEntry[] = [];
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRe.exec(html))) {
    try {
      const parsedJson = JSON.parse(ldMatch[1]) as {
        mainEntity?: { name?: string; url?: string };
        name?: string;
        url?: string;
      };
      const entity = parsedJson.mainEntity ?? parsedJson;
      const name = (entity.name ?? '').trim();
      const url = (entity.url ?? '').trim();
      const parsed = entry(ctx, name, url);
      if (parsed) fromLd.push(parsed);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  if (fromLd.length > 0) return dedupeByName(fromLd);

  const rows: DirectoryEntry[] = [];
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const block = match[1];
    const name = stripTags(block);
    const href = block.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
    const parsed = entry(ctx, name, websiteFromLink(href, ctx.source_url));
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

/** NBCC ACEP directory: JSON dump, MudBlazor/table rows, or named list items. */
export function parseNbccHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const trimmed = html.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseNbccJson(trimmed, ctx);
  }
  const fromTable = parseNbccTable(html, ctx);
  if (fromTable.length > 0) return fromTable;

  const rows: DirectoryEntry[] = [];
  const itemRe = /<(?:li|tr|h2|h3)[^>]*>([\s\S]*?)<\/(?:li|tr|h2|h3)>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html))) {
    const block = match[1];
    if (block.length > 4000) continue;
    if (isNbccHomeStudyOnly(block) || isNbccFormer(block)) continue;
    const nameMatch =
      block.match(/data-name=["']([^"']+)["']/i) ??
      block.match(/<(?:strong|b|a)[^>]*>([\s\S]*?)<\/(?:strong|b|a)>/i);
    const name = stripTags(nameMatch?.[1] ?? firstLineName(block));
    const href = block.match(/href=["'](https?:[^"']+)["']/i)?.[1] ?? '';
    const parsed = entry(ctx, name, websiteFromLink(href, ctx.source_url));
    if (parsed && !isNavNoise(parsed.provider_name)) rows.push(parsed);
  }

  return dedupeByName(rows);
}

export function parseNbccJson(raw: string, ctx: ParseContext): DirectoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(data)
    ? data
    : Array.isArray(rec.data)
      ? rec.data
      : Array.isArray(rec.rows)
        ? rec.rows
        : [];
  const rows: DirectoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (asBoolish(row.home_study_only) || asBoolish(row.former)) continue;
    if (row.active === false || row.active === 'false') continue;
    const live = row.liveTrainingProvider ?? row.live_training_provider;
    const homeStudy = row.isHomeStudy ?? row.is_home_study;
    if (asBoolish(homeStudy) && live !== undefined && live !== null && live !== '' && !asBoolish(live)) {
      continue;
    }
    const blob = `${row.status ?? ''} ${row.format ?? ''} ${row.program ?? ''}`;
    if (isNbccHomeStudyOnly(blob) || isNbccFormer(blob)) continue;
    const name = String(
      row.provider_name ??
        row.providerName ??
        row.name ??
        row.org_name ??
        row.acep_name ??
        row.ACEPName ??
        '',
    );
    const website = String(row.website ?? row.url ?? row.listed_website ?? row.WebSite ?? '');
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function parseNbccTable(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const trRe = /<(?:tr|div) class="[^"]*mud-table-row[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(html))) {
    const block = match[1] ?? match[2] ?? '';
    if (isNbccHomeStudyOnly(block) || isNbccFormer(block)) continue;
    const cells = [...block.matchAll(/<(?:td|div)[^>]*class="[^"]*mud-table-cell[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div)>|<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => stripTags(m[1] ?? m[2] ?? ''),
    );
    if (cells.length < 1) continue;
    const name = cells.find((c) => c.length > 2 && !/^https?:/i.test(c) && !/^[A-Z]{2}$/.test(c)) ?? cells[0];
    if (/^(acep|name|org|provider|website|state)/i.test(name)) continue;
    const href = block.match(/href=["'](https?:[^"']+)["']/i)?.[1] ?? cells.find((c) => /^https?:|^www\./i.test(c)) ?? '';
    const parsed = entry(ctx, name, href);
    if (parsed && !isNavNoise(parsed.provider_name)) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function isNbccHomeStudyOnly(blob: string): boolean {
  const text = blob.toLowerCase();
  return /home[\s-]*study/.test(text) && !/\blive\b/.test(text);
}

function isNbccFormer(blob: string): boolean {
  return /\bformer\b|inactive|not currently an acep/i.test(blob);
}

function asBoolish(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** ASWB ACE verification list (HTML fallback or JSON API body). */
export function parseAswbHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const trimmed = html.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseAswbJson(trimmed, ctx);
  }
  return parseNamedList(html, ctx);
}

export function parseAswbJson(raw: string, ctx: ParseContext): DirectoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [];
  const rows: DirectoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (isAswbIndividualCourse(String(rec.status ?? ''))) continue;
    const name = String(rec['provider name'] ?? rec.provider_name ?? rec.name ?? '');
    const website = String(rec['provider websites'] ?? rec.website ?? rec.url ?? '');
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

export function aswbJsonStats(raw: string): {
  apiRows: number;
  byStatus: Record<string, number>;
  skippedIndividualCourse: number;
  orgLevel: number;
  withWebsite: number;
} {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { apiRows: 0, byStatus: {}, skippedIndividualCourse: 0, orgLevel: 0, withWebsite: 0 };
  }
  const list = Array.isArray(data) ? data : [];
  const byStatus: Record<string, number> = {};
  let skippedIndividualCourse = 0;
  let orgLevel = 0;
  let withWebsite = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const status = String(rec.status ?? '(none)');
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (isAswbIndividualCourse(status)) {
      skippedIndividualCourse += 1;
      continue;
    }
    orgLevel += 1;
    const website = String(rec['provider websites'] ?? rec.website ?? rec.url ?? '').trim();
    if (website) withWebsite += 1;
  }
  return { apiRows: list.length, byStatus, skippedIndividualCourse, orgLevel, withWebsite };
}

function isAswbIndividualCourse(status: string): boolean {
  return /individual course/i.test(status);
}

/**
 * GreenCE / Ron Blank Course / Webinar / Lunch & Learn sponsor tables.
 * Drupal views: company name in h2, optional external website field.
 * Profile links stay on the CE platform and are not the company site.
 */
export function parseGreenceHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const titleRe = /views-field-title[\s\S]{0,400}?<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let match: RegExpExecArray | null;
  while ((match = titleRe.exec(html))) {
    const name = stripTags(match[1]);
    const after = html.slice(match.index, match.index + 1400);
    const websiteHref =
      after.match(/views-field-field-website[\s\S]{0,500}?href=["']([^"']+)["']/i)?.[1] ?? '';
    const websiteText = stripTags(
      after.match(/views-field-field-website[\s\S]{0,500}?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '',
    );
    const website = websiteFromLink(websiteHref, ctx.source_url) || websiteText;
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

const AEC_DAILY_SKIP_NAME = /^(aec daily|get started!?|register now!?)$/i;

/** AEC Daily featured JSON-LD orgs, live session providers, and named /s/ links. */
export function parseAecDailyHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const orgRe =
    /"@type":\s*"Organization"\s*,\s*"name":\s*"([^"]+)"\s*,\s*"url":\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = orgRe.exec(html))) {
    const parsed = entry(ctx, decodeJsonLdName(match[1]), aecSponsorSite(match[2]));
    if (parsed && !AEC_DAILY_SKIP_NAME.test(parsed.provider_name)) rows.push(parsed);
  }
  const providerRe = /<td class="session-provider"[^>]*>\s*<a href="(\/s\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = providerRe.exec(html))) {
    const parsed = entry(ctx, stripTags(match[2]), aecSponsorSite(match[1]));
    if (parsed && !AEC_DAILY_SKIP_NAME.test(parsed.provider_name)) rows.push(parsed);
  }
  for (const link of extractLinks(html, ctx.source_url)) {
    const id = link.href.match(/\/s\/(\d+)/)?.[1];
    if (!id) continue;
    const name = link.text.replace(/\s*\[.*?\]\s*/g, ' ').trim();
    if (!name || AEC_DAILY_SKIP_NAME.test(name) || name.length < 3) continue;
    const parsed = entry(ctx, name, aecSponsorSite(`/s/${id}`));
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function aecSponsorSite(raw: string): string {
  const id = raw.match(/\/s\/(\d+)/)?.[1];
  return id ? `https://www.aecdaily.com/s/${id}` : raw;
}

function decodeJsonLdName(raw: string): string {
  return stripTags(raw.replace(/\\u0026/g, '&').replace(/\\"/g, '"'));
}

/** CE Strong WP partners CPT JSON. */
export function parseCestrongHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const trimmed = html.trim();
  if (trimmed.startsWith('[')) {
    return parseCestrongJson(trimmed, ctx);
  }
  const rows: DirectoryEntry[] = [];
  for (const link of extractLinks(html, ctx.source_url)) {
    if (!/\/partners\/[^/]+\/?$/i.test(link.href)) continue;
    if (/\/partners\/?$/i.test(link.href)) continue;
    const parsed = entry(ctx, link.text, link.href);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

export function parseCestrongJson(raw: string, ctx: ParseContext): DirectoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [];
  const rows: DirectoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { title?: { rendered?: string }; link?: string; name?: string };
    const name = stripTags(rec.title?.rendered ?? rec.name ?? '');
    const parsed = entry(ctx, name, rec.link ?? '');
    if (parsed && !/^ce\s*\|?\s*strong$/i.test(parsed.provider_name)) rows.push(parsed);
  }
  return dedupeByName(rows);
}

const BNP_SKIP_SLUG =
  /^(multi-sponsor|no-sponsor|areditorial|sweets|architectural-record|aec-daily|bnp-media|aec-buildtech)$/i;

/** BNP CE Center architect sitemap: /architect/sponsors/{slug}. */
export function parseBnpHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const locRe = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRe.exec(html))) {
    const loc = match[1].trim();
    const slug = loc.match(/\/architect\/sponsors\/([^/]+)\/?$/i)?.[1];
    if (!slug) continue;
    if (BNP_SKIP_SLUG.test(slug) || /^aia-/i.test(slug)) continue;
    const parsed = entry(ctx, slugToCompanyName(slug), loc);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function slugToCompanyName(slug: string): string {
  const acronyms = new Set(['aia', 'us', 'usa', 'hvac', 'led', 'ada', 'gaf', '3m', 'sti', 'abb', 'crl', 'bqe', 'nrc']);
  return decodeURIComponent(slug)
    .split('-')
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      if (/^\d/.test(token) && token.length <= 3) return token.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

const APA_SKIP = /^(account name|website|city|state|zip|country|phone|homestudy)$/i;

/** APA CESA approved-sponsor table. */
export function parseApaHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(html))) {
    const cells = [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length < 2) continue;
    const name = cells[0] ?? '';
    if (APA_SKIP.test(name)) continue;
    const href = match[1].match(/href=["']([^"']+)["']/i)?.[1] ?? cells[1] ?? '';
    const parsed = entry(ctx, name, href.startsWith('http') || href.startsWith('www.') ? href : '');
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

/** AOTA approved providers: “Name / Website: url” in HTML or pdftotext. */
export function parseAotaHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const text = html.includes('<') ? htmlToText(html) : html;
  const rows: DirectoryEntry[] = [];
  const re = /([^\n|]{3,160}?)\s+Website:\s+(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const name = match[1].replace(/^\d+\.\s+/, '').trim();
    const site = match[2].replace(/[.,;]+$/, '');
    if (/^not provided$/i.test(site)) {
      const parsed = entry(ctx, name, '');
      if (parsed) rows.push(parsed);
      continue;
    }
    const parsed = entry(ctx, name, site);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

const ACPE_SKIP_TYPE = /international schools|pharmd|bpharm|joint providership/i;
const ACPE_KEEP_TYPE = /acpe cpe providers|joint accredited/i;

/** ACPE program-lookup HTML cards, or WP REST institution JSON. */
export function parseAcpeHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const trimmed = html.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseAcpeJson(trimmed, ctx);
  }
  const fromCards = parseAcpeResultCards(html, ctx);
  if (fromCards.length > 0) return fromCards;

  const rows: DirectoryEntry[] = [];
  const headingRe = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const after = html.slice(match.index, match.index + 1800);
    const typeLabel = stripTags(after.match(/Institution Type:([\s\S]{0,80})/i)?.[1] ?? '').trim();
    const program = stripTags(after.match(/institution-program[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');
    if (!keepAcpeListing(typeLabel, program)) continue;
    const name = stripTags(match[1])
      .replace(/\s*[–—-]\s*\(.*\)\s*$/, '')
      .trim();
    const parsed = entry(ctx, name, websiteFromAcpeBlock(after, ctx.source_url));
    if (parsed && !/^(cpe|isp|program lookup)$/i.test(parsed.provider_name)) rows.push(parsed);
  }
  return dedupeByName(rows);
}

export function parseAcpeJson(raw: string, ctx: ParseContext): DirectoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [];
  const rows: DirectoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const types = acpeTaxonomyLabels(rec, 'institution-type');
    const programs = acpeTaxonomyLabels(rec, 'insitution-program');
    if (!keepAcpeListing(types.join(' | '), programs.join(' | '))) continue;
    const title =
      rec.title && typeof rec.title === 'object'
        ? String((rec.title as { rendered?: string }).rendered ?? '')
        : String(rec.name ?? '');
    const content =
      rec.content && typeof rec.content === 'object'
        ? String((rec.content as { rendered?: string }).rendered ?? '')
        : '';
    const parsed = entry(ctx, decodeHtmlEntities(title), websiteFromAcpeBlock(content, ctx.source_url));
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function parseAcpeResultCards(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const blockRe =
    /<div class="institution-program">([\s\S]*?)<\/div>\s*<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]{0,1500}?Institution Type:[\s\S]{0,250})/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html))) {
    const program = stripTags(match[1]);
    const name = stripTags(match[2]);
    const typeLabel = stripTags((match[3].match(/Institution Type:([\s\S]{0,80})/i)?.[1] ?? '')).trim();
    if (!keepAcpeListing(typeLabel, program)) continue;
    const parsed = entry(ctx, name, websiteFromAcpeBlock(match[3], ctx.source_url));
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function keepAcpeListing(typeLabel: string, program: string): boolean {
  const type = typeLabel.trim();
  const prog = program.trim();
  if (/international schools/i.test(type) || /joint providership/i.test(type)) return false;
  if (/\bpharmd\b/i.test(prog) || /^isp$/i.test(prog)) return false;
  if (/^schools$/i.test(type)) return false;
  if (ACPE_KEEP_TYPE.test(type)) return true;
  return type.length === 0 && prog.length === 0;
}

function acpeTaxonomyLabels(rec: Record<string, unknown>, key: string): string[] {
  const tax = rec.taxonomy_info;
  if (tax && typeof tax === 'object') {
    const list = (tax as Record<string, unknown>)[key];
    if (Array.isArray(list)) {
      return list.map((item) => {
        if (!item || typeof item !== 'object') return String(item ?? '');
        const row = item as { label?: string; name?: string };
        return String(row.label ?? row.name ?? '');
      });
    }
  }
  return [];
}

function websiteFromAcpeBlock(block: string, pageUrl: string): string {
  const email = block.match(/mailto:([^"'\s>]+)/i)?.[1] ?? '';
  const domain = email.includes('@') ? email.split('@')[1] ?? '' : '';
  const href = block.match(/href=["'](https?:[^"']+)["']/i)?.[1] ?? '';
  if (href && hostnameOf(href) !== hostnameOf(pageUrl) && !/acpe-accredit\.org/i.test(href)) {
    return href;
  }
  return domain ? `https://${domain}/` : '';
}

function decodeHtmlEntities(raw: string): string {
  return stripTags(raw)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—');
}

/** ACPE program-lookup pager: "Found N Results" at 10 per page. */
export function acpePagePlan(
  html: string,
  pageUrl: string,
): { totalResults: number | null; pageUrls: string[] } {
  const match = html.match(/Found\s+([\d,]+)\s+Results/i);
  const totalResults = match ? Number(match[1].replace(/,/g, '')) : null;
  if (!totalResults || !Number.isFinite(totalResults)) {
    return { totalResults: null, pageUrls: nextPageUrls(html, pageUrl) };
  }
  const perPage = 10;
  const pageCount = Math.ceil(totalResults / perPage);
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return { totalResults, pageUrls: [] };
  }
  const pageUrls: string[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const path = page === 1 ? '/program-lookup/' : `/program-lookup/page/${page}/`;
    pageUrls.push(`${url.origin}${path}${url.search}`);
  }
  return { totalResults, pageUrls };
}

/** PACE renewal schedule: name + Renewal Status + website. */
export function parsePaceHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const fromBoxes = parsePaceRenewalBoxes(html, ctx);
  if (fromBoxes.length > 0) return fromBoxes;

  const rows: DirectoryEntry[] = [];
  const headingRe =
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>\s*(?:<p[^>]*>\s*)?Renewal Status:[\s\S]{0,400}?href=["']((?:https?:\/\/|www\.)[^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const name = stripTags(match[1]).trim();
    if (!name || /^all providers$/i.test(name)) continue;
    const parsed = entry(ctx, name, match[2]);
    if (parsed) rows.push(parsed);
  }
  if (rows.length > 0) return dedupeByName(rows);

  const text = htmlToText(html);
  const blockRe =
    /([A-Za-z0-9][^\n]{2,120}?)\s+Renewal Status:\s+\w+\s+Next Re-Application:[^\n]*?(https?:\/\/\S+|www\.\S+)/gi;
  while ((match = blockRe.exec(text))) {
    const name = match[1].replace(/^All Providers\s*/i, '').trim();
    if (!name) continue;
    const parsed = entry(ctx, name, match[2].replace(/[).,]+$/, ''));
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function parsePaceRenewalBoxes(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const headerRe = /<div class="[^"]*renewal-header[^"]*">([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(html))) {
    const name = stripTags(match[1]).trim();
    if (!name || /^all providers$/i.test(name)) continue;
    const after = html.slice(match.index, match.index + 900);
    if (!/Renewal Status:/i.test(after)) continue;
    const hrefs = [...after.matchAll(/href=["']((?:https?:\/\/|www\.)[^"']+)["']/gi)].map((m) => m[1]);
    const website = hrefs.find((href) => !/fclb\.org/i.test(href)) ?? '';
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

/** COPE administrator table (Org Name + Website) or DataTables ajax JSON. */
export function parseCopeHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const trimmed = html.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseCopeJson(trimmed, ctx);
  }
  const rows: DirectoryEntry[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(html))) {
    const cells = [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length < 3) continue;
    const name = cells[2] || cells[0];
    if (/^(org name|organization|last name)$/i.test(name)) continue;
    const href = match[1].match(/href=["'](https?:[^"']+)["']/i)?.[1] ?? cells.at(-1) ?? '';
    const parsed = entry(ctx, name, /^https?:|^www\./i.test(href) ? href : '');
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

export function parseCopeJson(raw: string, ctx: ParseContext): DirectoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(data)
    ? data
    : Array.isArray(rec.data)
      ? rec.data
      : Array.isArray(rec.aaData)
        ? rec.aaData
        : [];
  const rows: DirectoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = String(row.org_name ?? row.orgName ?? row.name ?? '');
    const website = String(row.website ?? row.url ?? '');
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

/** ARCAT CES manufacturer list: company name + off-site CES URL in loc=. */
export function parseArcatHtml(html: string, ctx: ParseContext): DirectoryEntry[] {
  const fromBlocks = parseArcatCesBlocks(html, ctx);
  if (fromBlocks.length > 0) return fromBlocks;

  const rows: DirectoryEntry[] = [];
  for (const link of extractLinks(html, ctx.source_url)) {
    const text = link.text.replace(/\s*\[.*?\]\s*/g, ' ').trim();
    if (isNavNoise(text) || text.length < 3) continue;
    const isCes =
      /ces/i.test(link.href) ||
      /ces web page/i.test(link.text) ||
      /continuing.education/i.test(link.href);
    if (!isCes && hostnameOf(link.href) === hostnameOf(ctx.source_url)) continue;
    const website = websiteFromLink(link.href, ctx.source_url);
    if (!website) continue;
    const parsed = entry(ctx, text, website);
    if (parsed) rows.push(parsed);
  }
  if (rows.length === 0) {
    return parseNamedList(html, ctx);
  }
  return dedupeByName(rows);
}

function parseArcatCesBlocks(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const blockRe = /<div class="ces-x"[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html))) {
    const block = match[1];
    const name = stripTags(block.match(/<a href="\/company\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
    const locRaw = block.match(/[?;&]loc=([^"'&]+)/i)?.[1] ?? '';
    let website = '';
    if (locRaw) {
      try {
        website = decodeURIComponent(locRaw);
      } catch {
        website = locRaw;
      }
    }
    const parsed = entry(ctx, name, website);
    if (parsed) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function parseNamedList(html: string, ctx: ParseContext): DirectoryEntry[] {
  const rows: DirectoryEntry[] = [];
  const itemRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html))) {
    const block = match[1];
    const name = stripTags(block.match(/<(?:a|strong|span)[^>]*>([\s\S]*?)<\/(?:a|strong|span)>/i)?.[1] ?? block);
    const href = block.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
    const parsed = entry(ctx, name, websiteFromLink(href, ctx.source_url));
    if (parsed && !isNavNoise(parsed.provider_name)) rows.push(parsed);
  }
  return dedupeByName(rows);
}

function firstLineName(block: string): string {
  return stripTags(block).split(/[|\n•]/)[0] ?? '';
}

function isNavNoise(name: string): boolean {
  const trimmed = name.trim();
  return /^(home|search|login|contact|about|privacy|next|previous|all aceps|filter|menu|skip to content|getting ready for the exam|examination appointments|connection interrupted|overview|schedule|read more|read more →|continuing education|scam alert|exam development)$/i.test(
    trimmed,
  );
}

function dedupeByName(rows: DirectoryEntry[]): DirectoryEntry[] {
  const seen = new Set<string>();
  const out: DirectoryEntry[] = [];
  for (const row of rows) {
    const key = row.provider_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function parseDirectoryHtml(
  directoryId: string,
  html: string,
  ctx: ParseContext,
): DirectoryEntry[] {
  switch (directoryId) {
    case 'nasba':
      return parseNasbaHtml(html, ctx);
    case 'nbcc':
      return parseNbccHtml(html, ctx);
    case 'aswb':
      return parseAswbHtml(html, ctx);
    case 'arcat':
      return parseArcatHtml(html, ctx);
    case 'greence':
    case 'ronblank':
      return parseGreenceHtml(html, ctx);
    case 'aecdaily':
      return parseAecDailyHtml(html, ctx);
    case 'cestrong':
      return parseCestrongHtml(html, ctx);
    case 'bnp':
      return parseBnpHtml(html, ctx);
    case 'apa':
      return parseApaHtml(html, ctx);
    case 'aota':
      return parseAotaHtml(html, ctx);
    case 'acpe':
      return parseAcpeHtml(html, ctx);
    case 'pace':
      return parsePaceHtml(html, ctx);
    case 'cope':
      return parseCopeHtml(html, ctx);
    default:
      return parseNamedList(html, ctx);
  }
}

export function nextPageUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  for (const link of extractLinks(html, pageUrl)) {
    const text = link.text.toLowerCase();
    const href = link.href;
    if (/\bnext\b/i.test(text) || /[?&]page=\d+/i.test(href) || /azLetterField=/i.test(href)) {
      urls.push(canonicalizeUrl(href));
    }
  }
  return [...new Set(urls)];
}

/** NASBA pager: site prints "N Results" at 100 per page. */
export function nasbaPagePlan(
  html: string,
  pageUrl: string,
): { totalResults: number | null; pageUrls: string[] } {
  const match = html.match(/([\d,]+)\s+Results/i);
  const totalResults = match ? Number(match[1].replace(/,/g, '')) : null;
  if (!totalResults || !Number.isFinite(totalResults)) {
    return { totalResults: null, pageUrls: nextPageUrls(html, pageUrl) };
  }
  const perPage = 100;
  const pageCount = Math.ceil(totalResults / perPage);
  const pageUrls: string[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const url = new URL(pageUrl);
    url.search = '';
    url.searchParams.set('page', String(page));
    pageUrls.push(url.toString());
  }
  return { totalResults, pageUrls };
}
