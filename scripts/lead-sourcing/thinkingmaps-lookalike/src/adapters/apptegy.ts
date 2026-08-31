import { isFreeMail } from '../directoryParse.js';
import { extractLinks, htmlToText } from '../lib/html.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { hostnameOf, originOf } from '../lib/url.js';
import { splitName } from '../quickenrich.js';
import { usableSchoolHint } from '../schoolNames.js';
import { classifySchoolRole, roleIsEligible } from '../schoolRoles.js';
import type { AdapterContext, AdapterResult, HarvestedPerson, JsonTap } from './types.js';

const STAFFISH = /staff|faculty|directory|employee|person/i;
const THRILLSHARE_DIR =
  /https:\/\/thrillshare-cmsv2\.services\.thrillshare\.com\/api\/v2\/s\/\d+\/directories/gi;
const THRILLSHARE_V4 = 'https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o';

export type ApptegyOrg = {
  id: string;
  name: string;
  path_prefix: string;
  slug: string;
};

export function schoolSlugsFromHtml(html: string, pageUrl: string): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
  const push = (slug: string) => {
    const value = slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(value) || seen.has(value)) return;
    seen.add(value);
    slugs.push(value);
  };
  for (const slug of slugsFromApptegyState(html)) push(slug);
  for (const link of extractLinks(html, pageUrl)) {
    const match = link.href.match(/\/o\/([a-z0-9][a-z0-9-]{1,60})(?:\/|$)/i);
    if (!match) continue;
    if (hostnameOf(link.href) && hostnameOf(link.href) !== hostnameOf(pageUrl)) continue;
    push(match[1]!);
  }
  if (slugs.length === 0) {
    for (const match of html.matchAll(/\/o\/([a-z0-9][a-z0-9-]{1,60})/gi)) push(match[1]!);
  }
  void originOf(pageUrl);
  return slugs.slice(0, 100);
}

export function slugsFromApptegyState(html: string): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
  const push = (slug: string) => {
    const value = slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(value) || seen.has(value)) return;
    if (/^(staff|news|events|home|about|calendar|documents)$/.test(value)) return;
    seen.add(value);
    slugs.push(value);
  };
  for (const match of html.matchAll(/path_prefix["\\:\s]*\\?\/o\\?\/([a-z0-9][a-z0-9-]{1,60})/gi)) {
    push(match[1]!);
  }
  const state = parseClientWorkState(html);
  if (state) walkSlugs(state, push);
  const nuxt = parseNuxtArray(html);
  if (nuxt) {
    for (const item of nuxt) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.slug === 'string') push(rec.slug);
      if (typeof rec.path === 'string') {
        const match = rec.path.match(/\/o\/([a-z0-9][a-z0-9-]{1,60})/i);
        if (match) push(match[1]!);
      }
    }
  }
  return slugs;
}

export function thrillshareDirectoryUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const clean = url.replace(/\\+/g, '');
    if (!clean.startsWith('http') || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  };
  for (const match of html.matchAll(THRILLSHARE_DIR)) push(match[0]!);
  const state = parseClientWorkState(html);
  if (state) walkStaffApis(state, push);
  return urls;
}

export function parseClientWorkState(html: string): unknown | null {
  const marker = html.indexOf('clientWorkStateTemp');
  if (marker < 0) return null;
  const parseAt = html.indexOf('JSON.parse(', marker);
  if (parseAt < 0 || parseAt > marker + 120) return null;
  const openQuote = html.indexOf('"', parseAt);
  if (openQuote < 0 || openQuote > parseAt + 40) return null;
  let i = openQuote + 1;
  let escaped = false;
  while (i < html.length) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') break;
    i += 1;
  }
  if (i >= html.length) return null;
  try {
    const unescaped = JSON.parse(html.slice(openQuote, i + 1)) as string;
    return JSON.parse(unescaped) as unknown;
  } catch {
    return null;
  }
}

function orgFromRec(item: unknown): ApptegyOrg | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const rec = item as Record<string, unknown>;
  const id = rec.id == null || rec.id === '' ? '' : String(rec.id);
  const prefix = typeof rec.path_prefix === 'string' ? rec.path_prefix : '';
  const slugMatch = prefix.match(/\/o\/([a-z0-9][a-z0-9-]{1,60})/i);
  if (!id || !slugMatch) return null;
  return {
    id,
    name: typeof rec.name === 'string' ? rec.name : '',
    path_prefix: prefix,
    slug: slugMatch[1]!.toLowerCase(),
  };
}

export function organizationsFromState(state: unknown): ApptegyOrg[] {
  const orgs: ApptegyOrg[] = [];
  const seen = new Set<string>();
  const push = (org: ApptegyOrg | null) => {
    if (!org || seen.has(org.id)) return;
    seen.add(org.id);
    orgs.push(org);
  };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        push(orgFromRec(item));
        walk(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.organizations)) {
      for (const item of rec.organizations) push(orgFromRec(item));
      return;
    }
    push(orgFromRec(rec));
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') walk(value);
    }
  };
  walk(state);
  return orgs;
}

export function organizationsFromHtml(html: string): ApptegyOrg[] {
  return organizationsFromState(parseClientWorkState(html));
}

export function v4DirectoryUrl(orgId: string): string {
  return `${THRILLSHARE_V4}/${orgId}/cms/directories`;
}

function parseNuxtArray(html: string): unknown[] | null {
  const nuxt = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!nuxt?.[1]) return null;
  try {
    const parsed = JSON.parse(nuxt[1]) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function walkSlugs(node: unknown, push: (slug: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkSlugs(item, push);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.slug === 'string') push(rec.slug);
  if (typeof rec.path === 'string') {
    const match = rec.path.match(/\/o\/([a-z0-9][a-z0-9-]{1,60})/i);
    if (match) push(match[1]!);
  }
  if (typeof rec.path_prefix === 'string') {
    const match = rec.path_prefix.match(/\/o\/([a-z0-9][a-z0-9-]{1,60})/i);
    if (match) push(match[1]!);
  }
  for (const value of Object.values(rec)) {
    if (value && typeof value === 'object') walkSlugs(value, push);
  }
}

function walkStaffApis(node: unknown, push: (url: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkStaffApis(item, push);
    return;
  }
  if (
    typeof node === 'string' &&
    node.includes('thrillshare-cmsv2.services.thrillshare.com') &&
    node.includes('/directories')
  ) {
    push(node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const value of Object.values(node)) walkStaffApis(value, push);
}

function hintFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ');
}

const GENERIC_LOCATION =
  /^(administration|district office|central office|all|staff|district|n\/a)$/i;

function schoolLocation(rec: Record<string, unknown>, schoolHint: string): string {
  const raw = field(rec, 'location', 'school', 'building', 'department', 'organization', 'site');
  if (raw && !GENERIC_LOCATION.test(raw.trim()) && usableSchoolHint(raw)) return raw;
  return schoolHint || raw;
}

function field(rec: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && 'name' in (value as object)) {
      const nested = String((value as { name?: unknown }).name ?? '').trim();
      if (nested) return nested;
    }
  }
  return '';
}

function derefNuxt(data: unknown[], value: unknown): unknown {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < data.length) {
    const next = data[value];
    if (typeof next === 'number' && next !== value) return derefNuxt(data, next);
    return next;
  }
  return value;
}

export function peopleFromNuxtData(raw: unknown, sourceUrl: string, schoolHint: string): HarvestedPerson[] {
  if (!Array.isArray(raw)) return peopleFromStaffJson(raw, sourceUrl, schoolHint);
  const data = raw as unknown[];
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const looksStaff =
      'email' in rec && ('first' in rec || 'first_name' in rec || 'full_name' in rec) && 'title' in rec;
    if (!looksStaff) continue;
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rec)) {
      resolved[key] = derefNuxt(data, value);
    }
    for (const person of peopleFromStaffJson(resolved, sourceUrl, schoolHint)) {
      if (seen.has(person.email)) continue;
      seen.add(person.email);
      people.push(person);
    }
  }
  return people;
}

export function peopleFromStaffJson(body: unknown, sourceUrl: string, schoolHint: string): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const email = field(rec, 'email', 'email_address', 'emailAddress', 'mail').toLowerCase();
    const name = field(rec, 'name', 'full_name', 'fullName', 'display_name', 'displayName');
    const first = field(rec, 'first_name', 'firstName', 'given_name', 'first');
    const last = field(rec, 'last_name', 'lastName', 'family_name', 'last');
    const title = field(rec, 'title', 'job_title', 'jobTitle', 'position', 'role');
    const location = schoolLocation(rec, schoolHint);
    if (email.includes('@') && !isFreeMail(email) && !seen.has(email) && (name || first || title)) {
      const split = name ? splitName(name) : { first_name: first, last_name: last };
      seen.add(email);
      people.push({
        first_name: split.first_name,
        last_name: split.last_name,
        title,
        email,
        school_hint: location,
        source_url: sourceUrl,
        evidence: schoolHint ? 'school_url' : location ? 'location_field' : 'path',
        platform: 'apptegy',
      });
    }
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') walk(value);
    }
  };
  walk(body);
  return people;
}

export function parseApptegyStaffHtml(html: string, sourceUrl: string, schoolHint: string): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const add = (person: HarvestedPerson) => {
    if (!person.email.includes('@') || seen.has(person.email)) return;
    seen.add(person.email);
    people.push(person);
  };
  const nuxt = parseNuxtArray(html);
  if (nuxt) {
    for (const person of peopleFromNuxtData(nuxt, sourceUrl, schoolHint)) add(person);
  }
  const trimmed = html.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      for (const person of peopleFromStaffJson(JSON.parse(trimmed) as unknown, sourceUrl, schoolHint)) add(person);
    } catch {
      // not json
    }
  }
  const blocks = html.split(/<\/(?:article|li|div|section|p)>/i);
  let heading = schoolHint;
  for (const block of blocks) {
    const h = block.match(/<h([1-4])[^>]*>([\s\S]*?)$/i);
    if (h?.[2]) heading = htmlToText(h[2]);
    const mailto = [...block.matchAll(/<a\b[^>]*href=["']mailto:([^"'>\s?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const match of mailto) {
      const email = decodeURIComponent(match[1] ?? '')
        .trim()
        .toLowerCase()
        .replace(/[>,;]+$/, '');
      if (!email.includes('@') || isFreeMail(email) || seen.has(email)) continue;
      const text = htmlToText(block);
      const name = htmlToText(match[2] ?? '');
      const split = name && !name.includes('@') ? splitName(name) : splitName(text.replace(email, ' '));
      const titleMatch = text.match(
        /\b(assistant principal|vice principal|instructional coach|principal|curriculum coordinator|dean of instruction)\b/i,
      );
      add({
        first_name: split.first_name,
        last_name: split.last_name,
        title: titleMatch?.[0] ?? '',
        email,
        school_hint: schoolHint || heading,
        source_url: sourceUrl,
        evidence: 'school_url',
        platform: 'apptegy',
      });
    }
  }
  return people;
}

function collectFromTaps(taps: JsonTap[], sourceUrl: string, hint: string): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  for (const tap of taps) {
    if (!STAFFISH.test(tap.url) && typeof tap.body !== 'object') continue;
    people.push(...peopleFromStaffJson(tap.body, tap.url || sourceUrl, hint));
  }
  return people;
}

export function parseDirectoryApiBody(html: string): unknown | null {
  const trimmed = html.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function followupDirectoryUrls(html: string, currentUrl: string): string[] {
  const body = parseDirectoryApiBody(html);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const rec = body as Record<string, unknown>;
  const meta = rec.meta && typeof rec.meta === 'object' && !Array.isArray(rec.meta) ? (rec.meta as Record<string, unknown>) : {};
  const links = meta.links && typeof meta.links === 'object' && !Array.isArray(meta.links) ? (meta.links as Record<string, unknown>) : {};
  const dirs = Array.isArray(rec.directories) ? rec.directories : [];
  const urls: string[] = [];
  const push = (url: string) => {
    if (!url.startsWith('http') || url === currentUrl || urls.includes(url)) return;
    urls.push(url);
  };
  if (typeof links.next === 'string') push(links.next);
  if (dirs.length === 0 && Array.isArray(meta.sections)) {
    for (const section of meta.sections) {
      if (!section || typeof section !== 'object') continue;
      const url = (section as { url?: unknown }).url;
      if (typeof url === 'string') push(url);
    }
  }
  return urls;
}

function collectPage(
  html: string,
  taps: JsonTap[],
  sourceUrl: string,
  hint: string,
): HarvestedPerson[] {
  return [...collectFromTaps(taps, sourceUrl, hint), ...parseApptegyStaffHtml(html, sourceUrl, hint)];
}

export async function harvestApptegy(ctx: AdapterContext): Promise<AdapterResult> {
  const notes: string[] = [];
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const directoryUrls: string[] = [];
  const xhrEndpoints: Array<{ platform: string; url: string }> = [];
  let pages = 0;

  const seenApis = new Set<string>();
  const addPeople = (rows: HarvestedPerson[], leadershipOnly = false) => {
    for (const person of rows) {
      if (!person.email.includes('@') || seen.has(person.email)) continue;
      const role = classifySchoolRole(person.title);
      if (leadershipOnly && !roleIsEligible(role)) continue;
      seen.add(person.email);
      people.push(person);
    }
  };

  const fetchApi = async (api: string, hint: string, maxHops: number): Promise<number> => {
    let added = 0;
    let url: string | undefined = api;
    let hops = 0;
    while (url && pages < ctx.maxPages && hops < maxHops && !seenApis.has(url)) {
      seenApis.add(url);
      directoryUrls.push(url);
      pages += 1;
      hops += 1;
      const page = await ctx.client.fetch(url);
      xhrEndpoints.push({ platform: 'apptegy', url });
      const before = people.length;
      addPeople(collectPage(page.html, page.jsonTaps, page.finalUrl || url, hint), true);
      added += people.length - before;
      const next = followupDirectoryUrls(page.html, url)[0];
      url = next;
    }
    return added;
  };

  const home = await ctx.client.fetch(ctx.website);
  pages += 1;
  if (home.status >= 400 || home.html.length < 80) {
    return { people, pages, directoryUrls, notes: ['homepage_fetch_failed'], xhrEndpoints };
  }
  addPeople(parseApptegyStaffHtml(home.html, home.finalUrl || ctx.website, ''));

  const state = parseClientWorkState(home.html);
  const orgs = organizationsFromState(state);
  const apis = thrillshareDirectoryUrls(home.html);
  notes.push(`orgs:${orgs.length}`);
  notes.push(`apis:${apis.length}`);

  await mapWithConcurrency(apis.slice(0, 6), 2, (api) => fetchApi(api, '', 300));

  if (orgs.length > 0) {
    const empty: ApptegyOrg[] = [];
    await mapWithConcurrency(orgs, 4, async (org) => {
      if (pages >= ctx.maxPages) return;
      const added = await fetchApi(v4DirectoryUrl(org.id), org.name, 8);
      if (added === 0) empty.push(org);
    });
    notes.push(`org_apis:${orgs.length}`);
    for (const org of empty) {
      if (pages >= ctx.maxPages) break;
      const orgHome = `${ctx.origin.replace(/\/$/, '')}/o/${org.slug}`;
      pages += 1;
      directoryUrls.push(orgHome);
      const homePage = await ctx.client.fetch(orgHome);
      if (homePage.status < 400 && homePage.html.length >= 40) {
        for (const tap of homePage.jsonTaps) xhrEndpoints.push({ platform: 'apptegy', url: tap.url });
        addPeople(collectPage(homePage.html, homePage.jsonTaps, homePage.finalUrl || orgHome, org.name), true);
        const extra = thrillshareDirectoryUrls(homePage.html).filter((api) => !seenApis.has(api)).slice(0, 2);
        for (const api of extra) {
          if (pages >= ctx.maxPages) break;
          await fetchApi(api, org.name, 6);
        }
      }
      if (pages >= ctx.maxPages) break;
      pages += 1;
      const staffUrl = `${orgHome}/staff`;
      directoryUrls.push(staffUrl);
      const page = await ctx.client.fetch(staffUrl);
      if (page.status >= 400 || page.html.length < 40) continue;
      for (const tap of page.jsonTaps) xhrEndpoints.push({ platform: 'apptegy', url: tap.url });
      addPeople(collectPage(page.html, page.jsonTaps, page.finalUrl || staffUrl, org.name), true);
    }
    notes.push(`people:${people.length}`);
    return { people, pages, directoryUrls, notes, xhrEndpoints };
  }

  const slugs = schoolSlugsFromHtml(home.html, home.finalUrl || ctx.website);
  notes.push(`slugs:${slugs.length}`);
  if (slugs.length === 0 && apis.length === 0) {
    const staffUrl = `${ctx.origin.replace(/\/$/, '')}/staff`;
    directoryUrls.push(staffUrl);
    pages += 1;
    const page = await ctx.client.fetch(staffUrl);
    for (const tap of page.jsonTaps) xhrEndpoints.push({ platform: 'apptegy', url: tap.url });
    addPeople(collectPage(page.html, page.jsonTaps, page.finalUrl || staffUrl, ''));
    notes.push(`people:${people.length}`);
    return { people, pages, directoryUrls, notes, xhrEndpoints };
  }

  const slugBudget = Math.max(0, ctx.maxPages - pages);
  const slugJobs = slugs.slice(0, slugBudget);
  pages += slugJobs.length;
  await mapWithConcurrency(slugJobs, 4, async (slug) => {
    const staffUrl = `${ctx.origin.replace(/\/$/, '')}/o/${slug}/staff`;
    directoryUrls.push(staffUrl);
    const page = await ctx.client.fetch(staffUrl);
    if (page.status >= 400 || page.html.length < 40) return;
    const hint = hintFromSlug(slug);
    for (const tap of page.jsonTaps) {
      if (STAFFISH.test(tap.url) || Array.isArray(tap.body) || (tap.body && typeof tap.body === 'object')) {
        xhrEndpoints.push({ platform: 'apptegy', url: tap.url });
      }
    }
    addPeople(collectPage(page.html, page.jsonTaps, page.finalUrl || staffUrl, hint), true);
    const extraApis = thrillshareDirectoryUrls(page.html).filter((api) => !seenApis.has(api)).slice(0, 2);
    for (const api of extraApis) {
      if (pages >= ctx.maxPages) break;
      await fetchApi(api, hint, 8);
    }
  });
  notes.push(`people:${people.length}`);
  return { people, pages, directoryUrls, notes, xhrEndpoints };
}
