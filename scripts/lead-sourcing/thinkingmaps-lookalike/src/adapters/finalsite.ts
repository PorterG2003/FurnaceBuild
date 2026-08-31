import { decodeFinalsiteEmail, directoryLinkScore, isFreeMail } from '../directoryParse.js';
import { extractLinks, htmlToText } from '../lib/html.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { originOf } from '../lib/url.js';
import { splitName } from '../quickenrich.js';
import { classifySchoolRole, roleIsEligible } from '../schoolRoles.js';
import { usableSchoolHint } from '../schoolNames.js';
import type { AdapterResult, AdapterContext, HarvestedPerson, PageClient } from './types.js';

export const FINALSITE_KEYWORDS = [
  'principal',
  'assistant principal',
  'vice principal',
  'instructional coach',
  'curriculum',
  'dean of instruction',
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const MAX_LETTER_PAGES = 8;
const FETCH_CONCURRENCY = 4;
const PROFILE_RESERVE = 80;

function inferredTitleFromSearch(sourceUrl: string): string {
  try {
    const keyword = (new URL(sourceUrl).searchParams.get('const_search_keyword') ?? '').trim().toLowerCase();
    if (!keyword) return '';
    if (/assistant principal|vice principal/.test(keyword)) return 'Assistant Principal';
    if (/instructional coach|curriculum|dean of instruction/.test(keyword)) return 'Instructional Coach';
    if (/\bprincipal\b/.test(keyword)) return 'Principal';
    return '';
  } catch {
    return '';
  }
}

export function parseFinalsiteDirectory(html: string, sourceUrl: string): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const chunks = html.includes('fsConstituentItem')
    ? html.split(/(?=fsConstituentItem)/)
    : html.split(/(?=FS\.util\.insertEmail|mailto:)/);

  for (const chunk of chunks) {
    if (!/fsFullName|fsConstituentItem|insertEmail|mailto:/i.test(chunk)) continue;
    const insert = chunk.match(
      /FS\.util\.insertEmail\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i,
    );
    const mailto = chunk.match(/mailto:([^"'>\s?]+)/i);
    const email = insert
      ? decodeFinalsiteEmail(insert[1] ?? '', insert[2] ?? '')
      : decodeURIComponent(mailto?.[1] ?? '')
          .trim()
          .toLowerCase()
          .replace(/[>,;]+$/, '');
    if (email && (!email.includes('@') || isFreeMail(email))) continue;
    const nameHtml =
      [...chunk.matchAll(/<[^>]*fsFullName[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)].at(-1)?.[1] ??
      [...chunk.matchAll(/<[^>]*fsFullName[^>]*>([\s\S]*?)<\/h3>/gi)].at(-1)?.[1] ??
      '';
    const titleHtml = [...chunk.matchAll(/<[^>]*fsTitles[^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] ?? '';
    const deptHtml = [...chunk.matchAll(/<[^>]*fsDepartments[^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] ?? '';
    const locHtml = [...chunk.matchAll(/<[^>]*fsLocations[^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] ?? '';
    const titleText = htmlToText(titleHtml).replace(/^(titles|departments):\s*/i, '');
    const deptText = htmlToText(deptHtml).replace(/^departments:\s*/i, '');
    const locText = htmlToText(locHtml).replace(/^locations:\s*/i, '');
    const name = splitName(htmlToText(nameHtml));
    if (!name.first_name && !name.last_name) continue;
    const schoolHint = usableSchoolHint(locText) ? locText : usableSchoolHint(deptText) ? deptText : locText || deptText;
    const title = titleText || (deptText && deptText !== schoolHint ? deptText : '') || inferredTitleFromSearch(sourceUrl);
    const key = (email || `${name.first_name}|${name.last_name}|${title}|${schoolHint}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({
      ...name,
      title,
      email,
      school_hint: schoolHint,
      source_url: sourceUrl,
      evidence: 'location_field',
      platform: 'finalsite',
      external_id: chunk.match(/data-constituent-id=["'](\d+)["']/i)?.[1],
    });
  }
  return people;
}

export function emailFromProfileHtml(html: string): string {
  const insert = html.match(
    /FS\.util\.insertEmail\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i,
  );
  if (insert) {
    const email = decodeFinalsiteEmail(insert[1] ?? '', insert[2] ?? '');
    if (email.includes('@') && !isFreeMail(email)) return email;
  }
  const mailto = html.match(/mailto:([^"'>\s?]+)/i);
  const email = decodeURIComponent(mailto?.[1] ?? '')
    .trim()
    .toLowerCase()
    .replace(/[>,;]+$/, '');
  if (email.includes('@') && !isFreeMail(email)) return email;
  return parseFinalsiteDirectory(html, '').find((row) => row.email.includes('@'))?.email ?? '';
}

export function parseFinalsitePageCount(html: string): { shown: number; total: number } | null {
  const match = html.match(/showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  if (!match) return null;
  return { shown: Number(match[2]), total: Number(match[3]) };
}

export function directoryElementId(html: string): string {
  return (
    html.match(/class="[^"]*fsDirectory[^"]*"[^>]*id="fsEl_(\d+)"/i)?.[1] ??
    html.match(/id="fsEl_(\d+)"[^>]*fsDirectory/i)?.[1] ??
    html.match(/fsDirectory[^>]*id="fsEl_(\d+)"/i)?.[1] ??
    html.match(/id="fsEl_(\d+)"[^>]*(?:fsDirectory|fsConstituent)/i)?.[1] ??
    ''
  );
}

function directoryUrlsFromHomepage(html: string, pageUrl: string): string[] {
  const scored = extractLinks(html, pageUrl)
    .map((link) => ({ href: link.href, score: directoryLinkScore(link.href, link.text) }))
    .filter((row) => row.score >= 4)
    .sort((a, b) => b.score - a.score);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    const key = href.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(href);
  };
  for (const row of scored) {
    push(row.href);
    if (urls.length >= 5) break;
  }
  const origin = originOf(pageUrl).replace(/\/$/, '');
  for (const path of ['/directory', '/staff-directory', '/staffdirectory', '/our-staff', '/staff']) {
    push(`${origin}${path}`);
  }
  return urls;
}

function withKeyword(dirUrl: string, keyword: string, lastName = ''): string {
  const url = new URL(dirUrl);
  url.searchParams.set('const_search_keyword', keyword);
  if (lastName) url.searchParams.set('const_search_last_name', lastName);
  else url.searchParams.delete('const_search_last_name');
  return url.toString();
}

function listingCap(maxPages: number): number {
  return Math.max(24, maxPages - PROFILE_RESERVE);
}

function profileUrls(origin: string, dirUrl: string, elementId: string, constituentId: string): string[] {
  const base = origin.replace(/\/$/, '');
  const urls: string[] = [];
  if (elementId) {
    urls.push(`${base}/fs/elements/${elementId}?const_id=${constituentId}&show_profile=true`);
    urls.push(`${base}/fs/elements/${elementId}?constituent_id=${constituentId}`);
    urls.push(`${base}/fs/elements/${elementId}?id=${constituentId}`);
  }
  try {
    const parsed = new URL(dirUrl);
    parsed.searchParams.set('const_id', constituentId);
    parsed.searchParams.set('show_profile', 'true');
    urls.push(parsed.toString());
  } catch {
    // ignore
  }
  return urls;
}

function mergePerson(into: HarvestedPerson[], person: HarvestedPerson, seen: Set<string>): boolean {
  const emailKey = person.email.includes('@') ? person.email.toLowerCase() : '';
  const nameKey = `${person.first_name}|${person.last_name}|${person.title}|${person.school_hint}`.toLowerCase();
  if (emailKey && seen.has(emailKey)) return false;
  const existing = into.find(
    (row) =>
      row.first_name.toLowerCase() === person.first_name.toLowerCase() &&
      row.last_name.toLowerCase() === person.last_name.toLowerCase() &&
      row.title.toLowerCase() === person.title.toLowerCase(),
  );
  if (existing) {
    if (!existing.email.includes('@') && person.email.includes('@')) existing.email = person.email;
    if (!existing.school_hint && person.school_hint) existing.school_hint = person.school_hint;
    if (emailKey) seen.add(emailKey);
    return false;
  }
  if (emailKey) seen.add(emailKey);
  else if (seen.has(nameKey)) return false;
  else seen.add(nameKey);
  into.push(person);
  return true;
}

async function fetchPeople(
  client: PageClient,
  url: string,
  into: HarvestedPerson[],
  seen: Set<string>,
): Promise<{ html: string; added: number; emails: number }> {
  const page = await client.fetch(url);
  if (page.status >= 400 || page.html.length < 80) return { html: '', added: 0, emails: 0 };
  let added = 0;
  let emails = 0;
  for (const person of parseFinalsiteDirectory(page.html, page.finalUrl || url)) {
    const before = into.length;
    mergePerson(into, person, seen);
    if (into.length > before) added += 1;
    if (person.email.includes('@')) emails += 1;
  }
  return { html: page.html, added, emails };
}

async function fillMissingEmails(
  ctx: AdapterContext,
  dirUrl: string,
  listingHtml: string,
  people: HarvestedPerson[],
  pages: { value: number },
): Promise<number> {
  const origin = originOf(dirUrl) || ctx.origin;
  const elementId = directoryElementId(listingHtml);
  const missing = people.filter((row) => {
    if (!row.external_id) return false;
    const role = classifySchoolRole(row.title);
    const missingEmail = !row.email.includes('@');
    const missingHint = !usableSchoolHint(row.school_hint);
    if (missingEmail && (roleIsEligible(role) || role === 'unknown')) return true;
    if (roleIsEligible(role) && missingHint) return true;
    return false;
  });
  missing.sort((a, b) => Number(a.email.includes('@')) - Number(b.email.includes('@')));
  const budget = Math.min(missing.length, Math.max(0, ctx.maxPages - pages.value));
  const batch = missing.slice(0, budget);
  let filled = 0;
  const applyProfile = (person: HarvestedPerson, html: string): boolean => {
    const parsed = parseFinalsiteDirectory(html, dirUrl);
    const named = parsed.filter(
      (row) =>
        row.first_name.toLowerCase() === person.first_name.toLowerCase() &&
        row.last_name.toLowerCase() === person.last_name.toLowerCase(),
    );
    const match = named.find((row) => row.email.includes('@')) ?? named[0] ?? parsed.find((row) => row.email.includes('@'));
    let changed = false;
    const email = match?.email || emailFromProfileHtml(html) || '';
    if (email.includes('@') && !person.email.includes('@')) {
      person.email = email;
      changed = true;
    }
    if (match?.school_hint && !usableSchoolHint(person.school_hint)) {
      person.school_hint = match.school_hint;
      changed = true;
    }
    if (match?.title && !person.title.trim()) {
      person.title = match.title;
      changed = true;
    }
    if (changed) filled += 1;
    return changed;
  };
  const tryUrl = async (person: HarvestedPerson, url: string): Promise<boolean> => {
    if (pages.value >= ctx.maxPages) return false;
    pages.value += 1;
    const page = await ctx.client.fetch(url);
    if (page.status >= 400 || page.html.length < 40) return false;
    return applyProfile(person, page.html);
  };
  const tryProfile = async (person: HarvestedPerson): Promise<boolean> => {
    if (!ctx.client.openProfile || !person.external_id || pages.value >= ctx.maxPages) return false;
    pages.value += 1;
    const page = await ctx.client.openProfile(dirUrl, person.external_id);
    if (page.status >= 400 || page.html.length < 40) return false;
    return applyProfile(person, page.html);
  };
  await mapWithConcurrency(batch, FETCH_CONCURRENCY, async (person) => {
    if (pages.value >= ctx.maxPages) return;
    for (const url of profileUrls(origin, dirUrl, elementId, person.external_id!)) {
      if (pages.value >= ctx.maxPages) return;
      if (await tryUrl(person, url)) return;
    }
    if (!person.email.includes('@') || !usableSchoolHint(person.school_hint)) await tryProfile(person);
  });
  return filled;
}

export async function harvestFinalsite(ctx: AdapterContext): Promise<AdapterResult> {
  const notes: string[] = [];
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const directoryUrls: string[] = [];
  let pages = 0;
  let listingHtml = '';

  const home = await ctx.client.fetch(ctx.website);
  pages += 1;
  if (home.status >= 400 || home.html.length < 80) {
    return { people, pages, directoryUrls, notes: ['homepage_fetch_failed'], xhrEndpoints: [] };
  }
  const listCap = listingCap(ctx.maxPages);
  const dirs = directoryUrlsFromHomepage(home.html, home.finalUrl || ctx.website);
  directoryUrls.push(...dirs);
  let dir = '';
  for (const candidate of [...dirs, `${ctx.origin.replace(/\/$/, '')}/directory`]) {
    if (pages >= listCap) break;
    const probe = withKeyword(candidate, 'principal');
    pages += 1;
    const { html, added, emails } = await fetchPeople(ctx.client, probe, people, seen);
    if (added > 0 || (html && /fsConstituentItem|insertEmail/i.test(html))) {
      dir = candidate;
      listingHtml = html;
      const counts = parseFinalsitePageCount(html);
      if (counts && counts.total > counts.shown) {
        notes.push(`truncated:principal:${counts.shown}/${counts.total}`);
        if (added > 0) {
          const letterUrls: string[] = [];
          for (const letter of LETTERS.slice(0, MAX_LETTER_PAGES)) {
            if (pages >= listCap) break;
            pages += 1;
            letterUrls.push(withKeyword(candidate, 'principal', letter));
          }
          await mapWithConcurrency(letterUrls, FETCH_CONCURRENCY, (url) =>
            fetchPeople(ctx.client, url, people, seen),
          );
        }
      }
      void emails;
      break;
    }
  }
  if (!dir) {
    notes.push('people:0');
    return { people, pages, directoryUrls, notes, xhrEndpoints: [] };
  }

  const keywordJobs: Array<{ keyword: string; url: string }> = [];
  for (const keyword of FINALSITE_KEYWORDS) {
    if (keyword === 'principal') continue;
    if (pages >= listCap) break;
    pages += 1;
    keywordJobs.push({ keyword, url: withKeyword(dir, keyword) });
  }
  const keywordHits = await mapWithConcurrency(keywordJobs, FETCH_CONCURRENCY, async ({ keyword, url }) => {
    const result = await fetchPeople(ctx.client, url, people, seen);
    return { keyword, ...result };
  });
  const letterJobs: string[] = [];
  for (const hit of keywordHits) {
    if (!hit?.html) continue;
    if (!listingHtml) listingHtml = hit.html;
    const counts = parseFinalsitePageCount(hit.html);
    if (counts && counts.total > counts.shown) {
      notes.push(`truncated:${hit.keyword}:${counts.shown}/${counts.total}`);
      if (hit.added > 0) {
        for (const letter of LETTERS.slice(0, MAX_LETTER_PAGES)) {
          if (pages >= listCap) break;
          pages += 1;
          letterJobs.push(withKeyword(dir, hit.keyword, letter));
        }
      }
    }
  }
  await mapWithConcurrency(letterJobs, FETCH_CONCURRENCY, (url) => fetchPeople(ctx.client, url, people, seen));

  const pageState = { value: pages };
  const filled = await fillMissingEmails(ctx, dir, listingHtml, people, pageState);
  pages = pageState.value;
  if (filled) notes.push(`profiles:${filled}`);
  notes.push(`people:${people.length}`);
  notes.push(`emails:${people.filter((row) => row.email.includes('@')).length}`);
  return { people, pages, directoryUrls, notes, xhrEndpoints: [] };
}
