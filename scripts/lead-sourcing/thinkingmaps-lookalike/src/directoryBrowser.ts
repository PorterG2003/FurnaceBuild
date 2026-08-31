import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPage } from './lib/http.js';
import { HostGate } from './lib/pool.js';
import type { FetchedPage, JsonTap, PageClient } from './adapters/types.js';

const STAFFISH_JSON = /staff|constituent|directory|employee|faculty|person/i;

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

function looksLikeStaffJson(url: string, text: string): boolean {
  if (text.length < 20 || text.length > 8_000_000) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  return STAFFISH_JSON.test(url) || /email|jobTitle|job_title|fullName|full_name|"staff"/i.test(trimmed.slice(0, 2000));
}

export function profileCacheUrl(listingUrl: string, constituentId: string): string {
  return `${listingUrl}#constituent-${constituentId}`;
}

export function createFixturePageClient(): PageClient {
  return {
    async fetch(url: string): Promise<FetchedPage> {
      const page = await fetchPage({ url, useFixtures: true });
      return {
        url,
        finalUrl: page.finalUrl || url,
        status: page.status,
        html: page.html,
        jsonTaps: [],
      };
    },
    async openProfile(listingUrl: string, constituentId: string): Promise<FetchedPage> {
      const page = await fetchPage({ url: profileCacheUrl(listingUrl, constituentId), useFixtures: true });
      if (page.status < 400 && page.html.length > 40) {
        return { url: listingUrl, finalUrl: listingUrl, status: page.status, html: page.html, jsonTaps: [] };
      }
      return { url: listingUrl, finalUrl: listingUrl, status: 404, html: '', jsonTaps: [] };
    },
  };
}

export function htmlNeedsBrowser(html: string, status: number): boolean {
  if (status >= 400 || status === 0) return true;
  const trimmed = html.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (/fsConstituentItem|FS\.util\.insertEmail|id="__NUXT_DATA__"|mailto:/i.test(html)) return false;
  if (trimmed.length < 80) return true;
  if (/you need to enable javascript|enable javascript to run this app/i.test(html)) return true;
  if (/cmsv2-static-cdn-prod\.apptegy\.net|apptegy\.net\/static_js/i.test(html) && !/__NUXT_DATA__/i.test(html)) {
    return true;
  }
  return false;
}

function readCache(cacheDir: string | undefined, url: string): FetchedPage | null {
  if (!cacheDir) return null;
  const htmlPath = join(cacheDir, `${cacheKey(url)}.html`);
  if (!existsSync(htmlPath)) return null;
  const jsonPath = join(cacheDir, `${cacheKey(url)}.json`);
  const html = readFileSync(htmlPath, 'utf8');
  const taps = existsSync(jsonPath) ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as JsonTap[]) : [];
  return { url, finalUrl: url, status: 200, html, jsonTaps: taps };
}

export function createHttpPageClient(options: { cacheDir?: string; hostGate?: HostGate } = {}): PageClient {
  return {
    async fetch(url: string): Promise<FetchedPage> {
      const cached = readCache(options.cacheDir, url);
      if (cached) return cached;
      const run = () => fetchPage({ url, cacheDir: options.cacheDir, timeoutMs: 20000 });
      const page = options.hostGate ? await options.hostGate.run(url, run) : await run();
      return {
        url,
        finalUrl: page.finalUrl || url,
        status: page.status,
        html: page.html,
        jsonTaps: [],
      };
    },
  };
}

type BrowserHandle = {
  client: PageClient;
  close: () => Promise<void>;
};

async function dismissCookies(page: { locator: (sel: string) => { first: () => { count: () => Promise<number>; click: (opts: { timeout: number }) => Promise<void> } } }): Promise<void> {
  for (const sel of [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler',
  ]) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.click({ timeout: 2500 });
      return;
    } catch {
      // banner already gone
    }
  }
}

export async function createPlaywrightPageClient(options: {
  cacheDir?: string;
  headless?: boolean;
  hostGate?: HostGate;
  userDataDir?: string;
}): Promise<BrowserHandle> {
  const { chromium } = await import('playwright');
  void options.userDataDir;
  const launchOptions = {
    headless: options.headless !== false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  };
  const browser = await chromium
    .launch({ ...launchOptions, channel: 'chrome' })
    .catch(() => chromium.launch(launchOptions));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  const jsonTaps: JsonTap[] = [];

  page.on('response', async (res) => {
    try {
      const type = res.headers()['content-type'] ?? '';
      if (!/json|javascript/i.test(type) && !STAFFISH_JSON.test(res.url())) return;
      const text = await res.text();
      if (!looksLikeStaffJson(res.url(), text)) return;
      jsonTaps.push({ url: res.url(), body: JSON.parse(text) as unknown });
    } catch {
      // ignore closed or non-json
    }
  });

  const pageLock = { chain: Promise.resolve() };
  const withPage = async <T,>(fn: () => Promise<T>): Promise<T> => {
    let release!: () => void;
    const prev = pageLock.chain;
    pageLock.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const fetchOne = async (url: string): Promise<FetchedPage> => {
    jsonTaps.length = 0;
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const markers = page.locator('.fsConstituentItem, #__NUXT_DATA__, a[href^="mailto:"]');
      if ((await markers.count()) === 0) {
        await Promise.race([
          page.waitForSelector('.fsConstituentItem, #__NUXT_DATA__, a[href^="mailto:"]', { timeout: 2500 }),
          page.waitForTimeout(900),
        ]).catch(() => {});
        await dismissCookies(page);
      }
      const html = await page.content();
      const taps = jsonTaps.slice();
      const finalUrl = page.url() || url;
      const status = response?.status() ?? 0;
      if (options.cacheDir) {
        mkdirSync(options.cacheDir, { recursive: true });
        writeFileSync(join(options.cacheDir, `${cacheKey(url)}.html`), html, 'utf8');
        writeFileSync(join(options.cacheDir, `${cacheKey(url)}.json`), `${JSON.stringify(taps, null, 2)}\n`, 'utf8');
      }
      return { url, finalUrl, status, html, jsonTaps: taps };
    } catch {
      return { url, finalUrl: url, status: 0, html: '', jsonTaps: [] };
    }
  };

  const hostGate = options.hostGate;
  const client: PageClient = {
    async fetch(url: string) {
      const cached = readCache(options.cacheDir, url);
      if (cached && !htmlNeedsBrowser(cached.html, cached.status)) return cached;
      return withPage(() => (hostGate ? hostGate.run(url, () => fetchOne(url)) : fetchOne(url)));
    },
    async openProfile(listingUrl: string, constituentId: string): Promise<FetchedPage> {
      const cacheUrl = profileCacheUrl(listingUrl, constituentId);
      const cached = readCache(options.cacheDir, cacheUrl);
      if (cached && /mailto:|insertEmail/i.test(cached.html)) return cached;
      return withPage(async () => {
        const run = async (): Promise<FetchedPage> => {
          jsonTaps.length = 0;
          try {
            const current = page.url();
            let listingPath = '';
            try {
              listingPath = new URL(listingUrl).pathname;
            } catch {
              listingPath = listingUrl;
            }
            if (!current.includes(listingPath)) {
              await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
              await dismissCookies(page);
            }
            const selectors = [
              `a.fsConstituentProfileLink[data-constituent-id="${constituentId}"]`,
              `[data-constituent-id="${constituentId}"] a.fsConstituentProfileLink`,
              `.fsConstituentItem[data-constituent-id="${constituentId}"] a`,
            ];
            let link = page.locator(selectors[0]!).first();
            for (const sel of selectors) {
              const candidate = page.locator(sel).first();
              if ((await candidate.count()) > 0) {
                link = candidate;
                break;
              }
            }
            if ((await link.count()) === 0) {
              return { url: cacheUrl, finalUrl: page.url() || listingUrl, status: 404, html: '', jsonTaps: [] };
            }
            await link.click({ timeout: 4000 });
            await Promise.race([
              page.waitForSelector('a[href^="mailto:"], .fsDialog, .fsEmail', { timeout: 4000 }),
              page.waitForTimeout(1200),
            ]).catch(() => {});
            const dialog = await page
              .locator('.fsDialog, .fsConstituentProfile, [role="dialog"]')
              .first()
              .innerHTML()
              .catch(() => '');
            const html = dialog && /mailto:|insertEmail|fsEmail/i.test(dialog) ? dialog : await page.content();
            const taps = jsonTaps.slice();
            if (options.cacheDir) {
              mkdirSync(options.cacheDir, { recursive: true });
              writeFileSync(join(options.cacheDir, `${cacheKey(cacheUrl)}.html`), html, 'utf8');
              writeFileSync(join(options.cacheDir, `${cacheKey(cacheUrl)}.json`), `${JSON.stringify(taps, null, 2)}\n`);
            }
            return { url: cacheUrl, finalUrl: page.url() || listingUrl, status: 200, html, jsonTaps: taps };
          } catch {
            return { url: cacheUrl, finalUrl: listingUrl, status: 0, html: '', jsonTaps: [] };
          }
        };
        return hostGate ? hostGate.run(listingUrl, run) : run();
      });
    },
  };

  return {
    client,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export function createHybridPageClient(
  http: PageClient,
  browser: PageClient,
  cacheDir?: string,
): PageClient {
  return {
    async fetch(url: string): Promise<FetchedPage> {
      const cached = readCache(cacheDir, url);
      if (cached && !htmlNeedsBrowser(cached.html, cached.status)) return cached;
      if (cached && htmlNeedsBrowser(cached.html, cached.status) && cacheDir) {
        const htmlPath = join(cacheDir, `${cacheKey(url)}.html`);
        try {
          unlinkSync(htmlPath);
        } catch {
          // ignore
        }
        return browser.fetch(url);
      }
      const httpPage = await http.fetch(url);
      if (!htmlNeedsBrowser(httpPage.html, httpPage.status)) return httpPage;
      if (cacheDir) {
        const htmlPath = join(cacheDir, `${cacheKey(url)}.html`);
        try {
          unlinkSync(htmlPath);
        } catch {
          // ignore
        }
      }
      return browser.fetch(url);
    },
    async openProfile(listingUrl: string, constituentId: string): Promise<FetchedPage> {
      if (browser.openProfile) return browser.openProfile(listingUrl, constituentId);
      return { url: listingUrl, finalUrl: listingUrl, status: 404, html: '', jsonTaps: [] };
    },
  };
}

export async function dumpLowYield(options: {
  runDir: string;
  leaid: string;
  html: string;
  screenshot?: () => Promise<Buffer | void>;
}): Promise<void> {
  const dir = join(options.runDir, 'low-yield', options.leaid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'page.html'), options.html, 'utf8');
}
