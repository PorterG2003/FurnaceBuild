import type { Page } from 'playwright';
import type { IowaEntityDetailParsed, IowaSearchHit } from '@furnace/registry-server';
import {
  parseIowaEntityDetailHtml,
  parseIowaSearchResultsHtml,
  pickBestIowaSearchHit,
  type PickIowaHitResult,
} from '@furnace/registry-server';
import { isIowaSosRateLimitedPage, rateLimitBackoffMs } from './iowaRateLimit.js';

export const IOWA_SEARCH_URL = 'https://sos.iowa.gov/search/business/search.aspx';

export type IowaCompanyScrapeResult = {
  query: string;
  hits: IowaSearchHit[];
  pick: PickIowaHitResult;
  detail: IowaEntityDetailParsed | null;
  detailHtml?: string;
  officerNames: string[];
  registeredAgentName?: string;
  /** Set when Iowa SOS shows the rate-limit / captcha interstitial (e.g. “bird flew away”). */
  rateLimited?: boolean;
  error?: string;
};

function empty(extra?: Partial<IowaCompanyScrapeResult>): IowaCompanyScrapeResult {
  return {
    query: extra?.query ?? '',
    hits: extra?.hits ?? [],
    pick: extra?.pick ?? { hit: null, ambiguous: false, candidates: [] },
    detail: extra?.detail ?? null,
      detailHtml: extra?.detailHtml,
    officerNames: extra?.officerNames ?? [],
    registeredAgentName: extra?.registeredAgentName,
    rateLimited: extra?.rateLimited,
    error: extra?.error,
  };
}

async function readRateLimitState(page: Page): Promise<{ url: string; html: string; limited: boolean }> {
  const url = page.url();
  const html = await page.content();
  return { url, html, limited: isIowaSosRateLimitedPage(url, html) };
}

/**
 * Single pass: search → summary → officers. Returns `rateLimited: true` if any step lands on captcha/rate-limit HTML.
 */
async function scrapeIowaCompanyAttempt(page: Page, query: string): Promise<IowaCompanyScrapeResult> {
  const base = (): IowaCompanyScrapeResult =>
    empty({
      query,
      hits: [],
      pick: { hit: null, ambiguous: false, candidates: [] },
      detail: null,
      officerNames: [],
    });

  try {
    await page.goto(IOWA_SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    let rs = await readRateLimitState(page);
    if (rs.limited) {
      return { ...base(), rateLimited: true, error: 'iowa_rate_limit' };
    }

    if (/Access Denied/i.test(rs.html)) {
      return empty({
        query,
        error: 'Access Denied (use headed Chrome; do not set IOWA_HEADLESS=1)',
      });
    }

    await page.locator('#txtName').fill(query);
    await page.locator('button.btn.btn-primary[type="submit"]').click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2200);

    rs = await readRateLimitState(page);
    if (rs.limited) {
      return { ...base(), rateLimited: true, error: 'iowa_rate_limit' };
    }

    const searchHtml = rs.html;
    const hits = parseIowaSearchResultsHtml(searchHtml);
    const pick = pickBestIowaSearchHit(hits, query);

    if (!pick.hit) {
      return empty({ query, hits, pick });
    }

    const hit = pick.hit;
    if (hit.summaryHref) {
      await page.goto(new URL(hit.summaryHref, page.url()).toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
    }

    rs = await readRateLimitState(page);
    if (rs.limited) {
      return empty({ query, hits, pick, rateLimited: true, error: 'iowa_rate_limit' });
    }

    const summaryHtml = rs.html;

    const officersLink = page.getByRole('link', { name: /^officers$/i }).first();
    if ((await officersLink.count()) > 0) {
      await officersLink.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
    } else {
      const u = new URL(page.url());
      u.pathname = u.pathname.replace(/\/[^/]+\.aspx$/i, '/officers.aspx');
      await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
    }

    rs = await readRateLimitState(page);
    if (rs.limited) {
      return empty({ query, hits, pick, rateLimited: true, error: 'iowa_rate_limit' });
    }

    const officersHtml = rs.html;
    const detail = parseIowaEntityDetailHtml(summaryHtml, officersHtml);
    const officerNames = (detail?.officers ?? []).map((o) => o.name.trim()).filter(Boolean);
    const registeredAgentName = detail?.registeredAgentName?.trim();
    const detailHtml = `${summaryHtml}\n<!-- IOWA_OFFICERS_SPLIT -->\n${officersHtml}`;

    return {
      query,
      hits,
      pick,
      detail,
      detailHtml,
      officerNames,
      registeredAgentName: registeredAgentName || undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return empty({ query, error: msg });
  }
}

/**
 * Search Iowa SOS by business name and return best hit + summary/officers parse.
 * Retries with backoff when the site serves the rate-limit / captcha interstitial.
 */
export async function scrapeIowaCompanyFromSearchForm(page: Page, query: string): Promise<IowaCompanyScrapeResult> {
  const maxAttempts = Math.max(1, Math.min(12, Number(process.env.IOWA_RATELIMIT_RETRIES ?? '4')));

  let last: IowaCompanyScrapeResult | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await scrapeIowaCompanyAttempt(page, query);
    if (!last.rateLimited && last.error !== 'iowa_rate_limit') {
      return last;
    }
    if (attempt < maxAttempts - 1) {
      const waitMs = rateLimitBackoffMs(attempt);
      console.error(
        JSON.stringify({
          iowaRateLimit: true,
          attempt: attempt + 1,
          maxAttempts,
          waitMs,
          query,
        }),
      );
      await page.waitForTimeout(waitMs);
    }
  }

  return {
    ...(last ?? empty({ query })),
    error: 'iowa_rate_limit_exhausted_retries',
    rateLimited: true,
  };
}
