import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScrapeConfig } from './config.js';
import { parseCards, parseMetaBodyText, type CardSnapshot } from './parser.js';
import type { RawAd } from './types.js';

const HYDRATION_TIMEOUT_MS = 20_000;
const SCROLL_SETTLE_MS = 800;

type Page = {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state: 'networkidle', options?: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  title(): Promise<string>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  locator(selector: string): {
    innerText(): Promise<string>;
    first(): { isVisible(): Promise<boolean>; click(options?: { timeout: number }): Promise<void> };
  };
  getByRole(role: 'button', options: { name: RegExp }): {
    first(): { isVisible(): Promise<boolean>; click(options?: { timeout: number }): Promise<void> };
  };
};

export function buildSearchUrl(phrase: string, country = 'US'): string {
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', 'active');
  url.searchParams.set('ad_type', 'all');
  url.searchParams.set('country', country);
  url.searchParams.set('media_type', 'all');
  url.searchParams.set('q', phrase);
  url.searchParams.set('search_type', /\s/.test(phrase.trim()) ? 'keyword_exact_phrase' : 'keyword_unordered');
  return url.toString();
}

export function classifyPageState(bodyText: string, cardCount: number): 'ready' | 'no_results' | 'blocked' | 'pending' {
  const text = bodyText.toLowerCase();
  if (/log in to facebook|you must log in|create new account|login to continue|captcha|unusual activity/.test(text)) {
    return 'blocked';
  }
  if (cardCount > 0 || /library id:\s*\d/i.test(bodyText)) return 'ready';
  if (/\b0 results\b|no ads match|didn't find any ads|no results/.test(text)) return 'no_results';
  if (/\d[\d,]*\+?\s+results/.test(bodyText)) return 'pending';
  return 'pending';
}

async function dismissCookieConsent(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /allow all cookies|accept all|allow essential/i }).first(),
    page.getByRole('button', { name: /^accept$/i }).first(),
    page.locator('[data-testid="cookie-policy-manage-dialog-accept-button"]').first(),
  ];
  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function readCards(page: Page): Promise<{ cards: CardSnapshot[]; blocker: string | null; noResults: boolean; bodyText: string }> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const parsed = parseMetaBodyText(bodyText);
  return { ...parsed, bodyText };
}

async function waitForHydration(page: Page): Promise<'ready' | 'no_results' | 'blocked'> {
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { cards, blocker, noResults, bodyText } = await readCards(page);
    if (blocker) return 'blocked';
    const state = classifyPageState(bodyText, cards.length);
    if (state === 'ready') return 'ready';
    if (state === 'no_results' || noResults) return 'no_results';
    if (state === 'blocked') return 'blocked';
    await page.waitForTimeout(400);
  }
  throw new Error('Meta Ad Library did not hydrate before timeout');
}

async function saveFailure(page: Page, outputDir: string, name: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true }).catch(() => undefined);
  await writeFile(join(outputDir, `${name}.html`), await page.content().catch(() => ''), 'utf8');
}

function dedupeByAdId(ads: RawAd[]): RawAd[] {
  const seen = new Set<string>();
  const out: RawAd[] = [];
  for (const ad of ads) {
    const key = ad.adId ?? `${ad.advertiserName}|${ad.primaryText}|${ad.landingUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ad);
  }
  return out;
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
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
  });
  const page = (await browser.newPage({ viewport: { width: 1440, height: 960 } })) as unknown as Page;
  const ads: RawAd[] = [];
  try {
    const searchUrl = buildSearchUrl(phrase, config.country);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissCookieConsent(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const state = await waitForHydration(page);
    if (state === 'blocked') {
      await saveFailure(page, join(options.outputDir, 'failures'), 'blocked-1');
      return { ads, nextPage: 1, state: 'blocked' };
    }
    if (state === 'no_results') return { ads, nextPage: 1, state: 'completed' };

    let staleScrolls = 0;
    for (let attempt = 0; attempt < config.maxScrollAttempts; attempt += 1) {
      const { cards, blocker } = await readCards(page);
      if (blocker) {
        await saveFailure(page, join(options.outputDir, 'failures'), `blocked-${attempt + 1}`);
        return { ads: dedupeByAdId(ads), nextPage: attempt + 1, state: 'blocked' };
      }
      const query = { phrase, searchUrl, collectedAt: new Date().toISOString() };
      const parsed = parseCards(cards, query, 'dom');
      const before = ads.length;
      for (const ad of parsed) {
        if (ads.length >= config.maxAdsPerPhrase) break;
        if (ads.some((existing) => existing.adId && existing.adId === ad.adId)) continue;
        ads.push(ad);
      }
      if (ads.length >= config.maxAdsPerPhrase) {
        return { ads: ads.slice(0, config.maxAdsPerPhrase), nextPage: attempt + 2, state: 'completed' };
      }
      if (ads.length === before) {
        staleScrolls += 1;
        if (staleScrolls >= config.staleScrollLimit) break;
      } else {
        staleScrolls = 0;
      }
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
      await page.waitForTimeout(SCROLL_SETTLE_MS + Math.floor(Math.random() * 400));
      await page.waitForTimeout(config.rateMs);
    }

    if (ads.length === 0) {
      await saveFailure(page, join(options.outputDir, 'failures'), 'unparsed-1');
      throw new Error('Meta Ad Library hydrated but no cards matched the supported parsers');
    }
    return { ads: dedupeByAdId(ads), nextPage: config.maxScrollAttempts + 1, state: 'completed' };
  } catch (error) {
    await saveFailure(page, join(options.outputDir, 'failures'), 'error');
    return {
      ads: dedupeByAdId(ads),
      nextPage: options.startPage ?? 1,
      state: 'completed',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}
