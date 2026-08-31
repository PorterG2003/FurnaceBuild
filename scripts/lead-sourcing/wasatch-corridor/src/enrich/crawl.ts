import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEBINAR_PAGE_PATHS } from '../../config/sources.js';
import { htmlCacheKey } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import { htmlToText } from '../lib/html.js';
import { HttpStatusError, sleep } from '../lib/retry.js';
import type { CompanyRecord, PipelineContext } from '../types.js';

const USER_AGENT = 'FurnaceWasatchBot/1.0 (+https://furnace.build)';
const PAGE_TIMEOUT_MS = 6_000;

export type CrawledSite = {
  company_id: string;
  homepage: string;
  pages: Array<{ url: string; path: string; status: number; text: string; html: string }>;
  live_site: boolean;
};

function fixtureHtml(url: string): string | null {
  const mapPath = join(fixturesDir, 'url-map.json');
  if (!existsSync(mapPath)) return null;
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;
  const rel = map[url] ?? map[url.replace(/\/$/, '')];
  if (!rel) return null;
  const full = join(fixturesDir, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

async function fetchOnce(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    if (res.status === 429 || res.status >= 500) {
      throw new HttpStatusError(`HTTP ${res.status}`, res.status);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getPage(ctx: PipelineContext, url: string): Promise<{ status: number; html: string }> {
  if (ctx.fixtures) {
    const html = fixtureHtml(url);
    return html != null ? { status: 200, html } : { status: 404, html: '' };
  }
  const cacheDir = join(ctx.cacheRoot, 'html');
  const path = join(cacheDir, `${htmlCacheKey(url)}.html`);
  if (existsSync(path)) return { status: 200, html: readFileSync(path, 'utf8') };

  try {
    let response: Response;
    try {
      response = await fetchOnce(url);
    } catch (error) {
      if (error instanceof HttpStatusError) {
        await sleep(400);
        response = await fetchOnce(url);
      } else {
        throw error;
      }
    }
    const html = await response.text();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path, html, 'utf8');
    return { status: response.status, html };
  } catch {
    return { status: 0, html: '' };
  }
}

export function siteOrigin(domain: string): string {
  return `https://${domain.replace(/^https?:\/\//, '')}`;
}

export async function crawlCompany(ctx: PipelineContext, company: CompanyRecord): Promise<CrawledSite> {
  if (!company.domain) {
    return { company_id: company.company_id, homepage: '', pages: [], live_site: false };
  }
  const origin = siteOrigin(company.domain);
  const paths = ['/', '/about', '/contact', ...WEBINAR_PAGE_PATHS];
  const fetched = await Promise.all(
    paths.map(async (path) => {
      const url = path === '/' ? origin : `${origin}${path}`;
      const { status, html } = await getPage(ctx, url);
      return { url, path, status, html };
    }),
  );
  const pages: CrawledSite['pages'] = fetched
    .filter((p) => p.status >= 200 && p.status < 400 && p.html)
    .map((p) => ({ ...p, text: htmlToText(p.html).slice(0, 20_000) }));
  const live = pages.some((p) => p.path === '/' && p.status >= 200 && p.status < 400 && p.html.length > 200);
  company.live_site = live || pages.some((p) => p.html.length > 200);
  return { company_id: company.company_id, homepage: origin, pages, live_site: company.live_site };
}

export function combinedText(site: CrawledSite): string {
  return site.pages.map((p) => `## ${p.path}\n${p.text}`).join('\n\n').slice(0, 24_000);
}
