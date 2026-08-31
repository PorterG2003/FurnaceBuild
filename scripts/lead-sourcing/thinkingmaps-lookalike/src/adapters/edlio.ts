import { isFreeMail } from '../directoryParse.js';
import { extractLinks, htmlToText } from '../lib/html.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { hostnameOf, originOf, sameRegistrableHost } from '../lib/url.js';
import { splitName } from '../quickenrich.js';
import { classifySchoolRole, roleIsEligible } from '../schoolRoles.js';
import { schoolSiteUrls } from './generic.js';
import type { AdapterContext, AdapterResult, HarvestedPerson } from './types.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const SKIP_HOST = /edlioadmin\.com|google\.com|facebook|twitter/i;

function staffUrls(html: string, pageUrl: string): string[] {
  const host = hostnameOf(pageUrl);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    if (!href || SKIP_HOST.test(href)) return;
    const key = href.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return;
    const linkHost = hostnameOf(href);
    if (linkHost && host && !sameRegistrableHost(linkHost, host)) return;
    if (!/\/apps\/staff/i.test(href) && !/staff[-_ ]?directory/i.test(href)) return;
    seen.add(key);
    urls.push(href);
  };
  for (const link of extractLinks(html, pageUrl)) push(link.href);
  const origin = originOf(pageUrl).replace(/\/$/, '');
  push(`${origin}/apps/staff`);
  push(`${origin}/apps/staff/`);
  return urls.slice(0, 8);
}

export function parseEdlioStaff(html: string, sourceUrl: string): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const chunks = html.split(/(?=<li\b[^>]*class="[^"]*\bstaff\b)/i);
  for (const chunk of chunks) {
    if (!/\bstaff\b/i.test(chunk) || !/user-position|class="name"/i.test(chunk)) continue;
    const name = htmlToText(chunk.match(/class="name"[^>]*>\s*([\s\S]*?)<\/a>/i)?.[1] ?? '');
    const title = htmlToText(chunk.match(/user-position[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const schoolHint = htmlToText(chunk.match(/<div class="other"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const mailto = chunk.match(/mailto:([^"'>\s?]+)/i);
    const visible = chunk.match(/user-email[\s\S]{0,400}?>([\s\S]*?)<\/span>/i);
    const fromMailto = decodeURIComponent(mailto?.[1] ?? '')
      .trim()
      .toLowerCase()
      .replace(/[>,;]+$/, '');
    const fromText = (visible?.[1] ? htmlToText(visible[1]) : '').match(EMAIL_RE)?.[0]?.toLowerCase() ?? '';
    const email = fromMailto.includes('@') ? fromMailto : fromText;
    if (email && (!email.includes('@') || isFreeMail(email) || /\/apps\/email\//i.test(email))) continue;
    const split = splitName(name);
    if (!split.first_name && !split.last_name) continue;
    if (!roleIsEligible(classifySchoolRole(title))) continue;
    const key = (email || `${split.first_name}|${split.last_name}|${title}|${schoolHint}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({
      ...split,
      title,
      email,
      school_hint: schoolHint,
      source_url: sourceUrl,
      evidence: schoolHint ? 'location_field' : 'heading',
      platform: 'edlio',
    });
  }
  return people;
}

export async function harvestEdlio(ctx: AdapterContext): Promise<AdapterResult> {
  const notes: string[] = [];
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const directoryUrls: string[] = [];
  let pages = 0;

  const addPeople = (rows: HarvestedPerson[]) => {
    for (const person of rows) {
      const key = person.email.includes('@')
        ? person.email
        : `${person.first_name}|${person.last_name}|${person.title}|${person.school_hint}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push(person);
    }
  };

  const home = await ctx.client.fetch(ctx.website);
  pages += 1;
  if (home.status >= 400 || home.html.length < 80) {
    return { people, pages, directoryUrls, notes: ['homepage_fetch_failed'], xhrEndpoints: [] };
  }
  addPeople(parseEdlioStaff(home.html, home.finalUrl || ctx.website));

  const seeds = [
    ...staffUrls(home.html, home.finalUrl || ctx.website),
    ...schoolSiteUrls(home.html, home.finalUrl || ctx.website).flatMap((site) => {
      const origin = originOf(site).replace(/\/$/, '');
      return [`${origin}/apps/staff`, `${origin}/apps/staff/`];
    }),
  ];
  const urls: string[] = [];
  const seenUrl = new Set<string>();
  for (const url of seeds) {
    const key = url.replace(/\/$/, '').toLowerCase();
    if (seenUrl.has(key) || SKIP_HOST.test(url)) continue;
    seenUrl.add(key);
    urls.push(url);
  }
  notes.push(`staff_urls:${urls.length}`);
  const jobs = urls.slice(0, Math.max(0, ctx.maxPages - pages));
  pages += jobs.length;
  await mapWithConcurrency(jobs, 4, async (url) => {
    directoryUrls.push(url);
    const page = await ctx.client.fetch(url);
    if (page.status >= 400 || page.html.length < 80) return;
    addPeople(parseEdlioStaff(page.html, page.finalUrl || url));
  });
  notes.push(`people:${people.length}`);
  notes.push(`emails:${people.filter((row) => row.email.includes('@')).length}`);
  return { people, pages, directoryUrls, notes, xhrEndpoints: [] };
}
