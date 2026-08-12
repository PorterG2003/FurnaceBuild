import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScrapeConfig } from './config.js';
import { parseCards, type CardSnapshot } from './parser.js';
import type { RawAd } from './types.js';

const HYDRATION_TIMEOUT_MS = 20_000;

type Page = {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  locator(selector: string): {
    innerText(): Promise<string>;
    evaluateAll<T>(callback: (nodes: unknown[]) => T): Promise<T>;
  };
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildSearchUrl(phrase: string, country: string, page = 1, dateWindowDays = 45, now = new Date()): string {
  const url = new URL('https://www.linkedin.com/ad-library/search');
  url.searchParams.set('keyword', phrase);
  url.searchParams.set('countries', country);
  url.searchParams.set('page', String(page));
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - dateWindowDays);
  url.searchParams.set('dateOption', 'custom-date-range');
  url.searchParams.set('startdate', isoDate(start));
  url.searchParams.set('enddate', isoDate(end));
  return url.toString();
}

export function classifyPageState(bodyText: string): 'ready' | 'no_results' | 'blocked' | 'pending' {
  const text = bodyText.toLowerCase();
  if (/captcha|unusual activity|sign in|log in|verify you are/.test(text)) return 'blocked';
  if (/no ads|no results|0 results/.test(text)) return 'no_results';
  if (/sponsored|ad preview|\d+\s+(?:ads|results)\b/.test(text)) return 'ready';
  return 'pending';
}

async function waitForHydration(page: Page): Promise<'ready' | 'no_results' | 'blocked'> {
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = classifyPageState(await page.locator('body').innerText().catch(() => ''));
    if (state !== 'pending') return state;
    await page.waitForTimeout(400);
  }
  throw new Error('LinkedIn Ad Library did not hydrate before timeout');
}

async function snapshotCards(page: Page): Promise<CardSnapshot[]> {
  return page.locator('li.search-result-item, article, [data-test-ad-card], [data-testid*="ad-card"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      const links = [...element.querySelectorAll('a')].map((anchor) => ({
        href: (anchor as HTMLAnchorElement).href,
        text: (anchor.textContent ?? '').trim(),
      }));
      const adLabel = element.querySelector('[aria-label*="View details"]')?.getAttribute('aria-label') ?? '';
      const detailUrl = links.find(({ href }) => /\/ad-library\/detail\/\d+/i.test(href))?.href ?? null;
      const creativeImageUrls = [...element.querySelectorAll('.ad-preview img, [data-creative-type] img')]
        .map((image) => (image as HTMLImageElement).src)
        .filter((src) => src && !/company-logo|advertiser.*logo/i.test(src));
      return {
        text: element.innerText,
        links,
        creativeImageUrls: [...new Set(creativeImageUrls)],
        attributes: {
          'data-ad-id': element.getAttribute('data-ad-id') ?? detailUrl?.match(/\/detail\/(\d+)/i)?.[1] ?? null,
          'data-detail-url': element.getAttribute('data-detail-url') ?? detailUrl,
          'data-advertiser-name': element.getAttribute('data-advertiser-name') ?? adLabel.split(',')[0]?.trim() ?? null,
          'data-advertiser-url': element.getAttribute('data-advertiser-url'),
          'data-payer-name': element.getAttribute('data-payer-name'),
          'data-primary-text': element.getAttribute('data-primary-text') ?? element.querySelector('.commentary__content')?.textContent?.trim() ?? null,
          'data-headline': element.getAttribute('data-headline'),
          'data-landing-url': element.getAttribute('data-landing-url'),
          'data-active-from': element.getAttribute('data-active-from'),
          'data-active-to': element.getAttribute('data-active-to'),
          'data-status': element.getAttribute('data-status'),
        },
      };
    }),
  );
}

async function enrichFromDetail(page: Page, ad: RawAd): Promise<RawAd> {
  if (!ad.detailUrl) return ad;
  try {
    await page.goto(ad.detailUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(400);
    const expanded = await page.locator('button, [role="button"]').evaluateAll((nodes) => {
      const candidate = nodes.find((node) => /^(?:…\s*)?(see|show)\s+more$/i.test((node as HTMLElement).innerText.trim()));
      if (!candidate) return false;
      (candidate as HTMLElement).click();
      return true;
    }).catch(() => false);
    if (expanded) await page.waitForTimeout(300);
    const [bodyText, externalLinks, detailCopyParts, detailImages] = await Promise.all([
      page.locator('body').innerText().catch(() => ''),
      page.locator('a[href^="http"]:not([href*="linkedin.com"])').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).href),
      ).catch(() => [] as string[]),
      page.locator('.commentary__content, [data-test-id*="commentary"], [data-testid*="commentary"]').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).innerText.trim()).filter(Boolean),
      ).catch(() => [] as string[]),
      page.locator('.ad-preview img, [data-creative-type] img').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).src).filter((src) => src && !/company-logo|advertiser.*logo/i.test(src)),
      ).catch(() => [] as string[]),
    ]);
    const landingUrl = externalLinks.find((url) => /^https?:\/\//i.test(url)) ?? ad.landingUrl;
    const activeFrom = bodyText.match(/(?:started running|first ran|started on)\s*:?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? ad.activeFrom;
    const detailCopy = [...detailCopyParts].sort((a, b) => b.length - a.length)[0] ?? '';
    return {
      ...ad,
      primaryText: detailCopy.length > (ad.primaryText?.length ?? 0) ? detailCopy : ad.primaryText,
      creativeImageUrls: [...new Set([...ad.creativeImageUrls, ...detailImages])],
      landingUrl,
      activeFrom,
    };
  } catch {
    return ad;
  }
}

async function saveFailure(page: Page, outputDir: string, name: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true }).catch(() => undefined);
  await writeFile(join(outputDir, `${name}.html`), await page.content().catch(() => ''), 'utf8');
}

export async function collectPhrase(
  phrase: string,
  config: ScrapeConfig,
  options: { headless: boolean; outputDir: string; startPage?: number; fixtures?: boolean },
): Promise<{ ads: RawAd[]; nextPage: number; state: 'completed' | 'blocked'; error?: string }> {
  if (options.fixtures) {
    const fixturePath = fileURLToPath(new URL('./fixtures/search-page.json', import.meta.url));
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as CardSnapshot[];
    const query = { phrase, searchUrl: `fixture://${phrase}`, collectedAt: new Date().toISOString() };
    return { ads: parseCards(fixture, query, 'fixture'), nextPage: 1, state: 'completed' };
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: options.headless,
    ...(options.headless ? {} : { channel: 'chrome' }),
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const ads: RawAd[] = [];
  try {
    for (let pageNumber = options.startPage ?? 1; pageNumber <= config.maxPagesPerPhrase; pageNumber += 1) {
      const searchUrl = buildSearchUrl(phrase, config.country, pageNumber, config.dateWindowDays);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const state = await waitForHydration(page);
      if (state === 'blocked') {
        await saveFailure(page, join(options.outputDir, 'failures'), `blocked-${pageNumber}`);
        return { ads, nextPage: pageNumber, state: 'blocked' };
      }
      if (state === 'no_results') return { ads, nextPage: pageNumber, state: 'completed' };
      const cards = await snapshotCards(page);
      const parsed = parseCards(cards, { phrase, searchUrl, collectedAt: new Date().toISOString() }, 'dom');
      if (parsed.length === 0) {
        await saveFailure(page, join(options.outputDir, 'failures'), `unparsed-${pageNumber}`);
        throw new Error('Ad Library hydrated but no cards matched the supported selectors');
      }
      for (const ad of parsed) {
        if (ads.length >= config.maxAdsPerPhrase) break;
        ads.push(await enrichFromDetail(page, ad));
      }
      if (ads.length >= config.maxAdsPerPhrase) return { ads: ads.slice(0, config.maxAdsPerPhrase), nextPage: pageNumber + 1, state: 'completed' };
      await page.waitForTimeout(config.rateMs + Math.floor(Math.random() * 500));
    }
    return { ads, nextPage: config.maxPagesPerPhrase + 1, state: 'completed' };
  } catch (error) {
    await saveFailure(page, join(options.outputDir, 'failures'), 'error');
    return { ads, nextPage: options.startPage ?? 1, state: 'completed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser.close();
  }
}
