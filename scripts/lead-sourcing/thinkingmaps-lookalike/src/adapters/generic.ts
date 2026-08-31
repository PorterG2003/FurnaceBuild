import { commonDirectoryPaths, directoryLinkScore, parseStaffDirectory } from '../directoryParse.js';
import { extractLinks } from '../lib/html.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { hostnameOf, originOf, sameRegistrableHost } from '../lib/url.js';
import { looksLikeSchoolName, schoolHintFromHost } from '../schoolNames.js';
import type { AdapterContext, AdapterResult, HarvestedPerson } from './types.js';

function pickDirectoryUrls(html: string, pageUrl: string): string[] {
  const host = hostnameOf(pageUrl);
  const scored = extractLinks(html, pageUrl)
    .map((link) => ({ href: link.href, text: link.text, score: directoryLinkScore(link.href, link.text) }))
    .filter((row) => row.score >= 5 && (!hostnameOf(row.href) || sameRegistrableHost(hostnameOf(row.href), host)))
    .sort((a, b) => b.score - a.score);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const key = row.href.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(row.href);
    if (urls.length >= 4) break;
  }
  if (urls.length === 0) {
    urls.push(...commonDirectoryPaths(originOf(pageUrl)).slice(0, 3));
  }
  return urls;
}

export function schoolSiteUrls(html: string, pageUrl: string): string[] {
  const host = hostnameOf(pageUrl);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    const key = href.replace(/\/$/, '').toLowerCase();
    if (seen.has(key) || !href) return;
    const linkHost = hostnameOf(href);
    if (linkHost && !sameRegistrableHost(linkHost, host)) {
      if (!linkHost.endsWith(`.${host}`) && host && !host.endsWith(`.${linkHost}`)) return;
    }
    seen.add(key);
    urls.push(href);
  };

  for (const link of extractLinks(html, pageUrl)) {
    const hay = `${link.href} ${link.text}`.toLowerCase();
    if (/facebook|twitter|instagram|youtube|linkedin/.test(hay)) continue;
    const linkHost = hostnameOf(link.href);
    const subdomain = Boolean(linkHost && host && linkHost !== host && sameRegistrableHost(linkHost, host));
    if (subdomain) push(link.href);
    else if (looksLikeSchoolName(link.text) || /\/schools?\//i.test(link.href)) push(link.href);
  }
  return urls.slice(0, 18);
}

export async function harvestGeneric(ctx: AdapterContext): Promise<AdapterResult> {
  const notes: string[] = [];
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();
  const directoryUrls: string[] = [];
  let pages = 0;

  const addFrom = (html: string, url: string, evidence: HarvestedPerson['evidence']) => {
    const hostHint = schoolHintFromHost(url, ctx.website);
    for (const row of parseStaffDirectory(html, url)) {
      if (seen.has(row.email)) continue;
      seen.add(row.email);
      people.push({
        ...row,
        school_hint: row.school_hint || hostHint,
        evidence: hostHint && !row.school_hint ? 'school_url' : evidence,
        platform: 'generic',
      });
    }
  };

  const home = await ctx.client.fetch(ctx.website);
  pages += 1;
  if (home.status >= 400 || home.html.length < 80) {
    return { people, pages, directoryUrls, notes: ['homepage_fetch_failed'], xhrEndpoints: [] };
  }
  addFrom(home.html, home.finalUrl || ctx.website, 'heading');

  const schoolSites = schoolSiteUrls(home.html, home.finalUrl || ctx.website);
  notes.push(`school_sites:${schoolSites.length}`);
  const startUrls = schoolSites.filter((url) => url.replace(/\/$/, '').toLowerCase() !== (home.finalUrl || ctx.website).replace(/\/$/, '').toLowerCase());
  const siteBudget = Math.max(0, ctx.maxPages - pages);
  const siteJobs = startUrls.slice(0, siteBudget);
  pages += siteJobs.length;
  const sitePages = await mapWithConcurrency(siteJobs, 4, async (start) => {
    const page = await ctx.client.fetch(start);
    if (page.status >= 400 || page.html.length < 80) return null;
    return { html: page.html, pageUrl: page.finalUrl || start };
  });

  const fetchedSites = sitePages.filter((row): row is { html: string; pageUrl: string } => row !== null);
  const dirJobs: Array<{ dir: string; html: string; pageUrl: string; evidence: HarvestedPerson['evidence'] }> = [];
  for (const row of [{ html: home.html, pageUrl: home.finalUrl || ctx.website }, ...fetchedSites]) {
    const dirs = pickDirectoryUrls(row.html, row.pageUrl);
    for (const dir of dirs) {
      const key = dir.replace(/\/$/, '').toLowerCase();
      if (directoryUrls.some((u) => u.replace(/\/$/, '').toLowerCase() === key)) continue;
      directoryUrls.push(dir);
      const evidence: HarvestedPerson['evidence'] =
        hostnameOf(dir) !== hostnameOf(ctx.website) ? 'school_url' : 'heading';
      if (dir.replace(/\/$/, '').toLowerCase() === row.pageUrl.replace(/\/$/, '').toLowerCase()) {
        addFrom(row.html, row.pageUrl, evidence);
        continue;
      }
      if (pages >= ctx.maxPages) break;
      pages += 1;
      dirJobs.push({ dir, html: row.html, pageUrl: row.pageUrl, evidence });
    }
  }
  await mapWithConcurrency(dirJobs, 4, async (job) => {
    const page = await ctx.client.fetch(job.dir);
    if (page.status >= 400 || page.html.length < 80) return;
    addFrom(page.html, page.finalUrl || job.dir, job.evidence);
  });

  notes.push(`people:${people.length}`);
  return { people, pages, directoryUrls, notes, xhrEndpoints: [] };
}
