import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { COUNTRY_URLS, type CountryCode } from './types.ts';

export type ExpBrowser = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** True when we connected to an already-running Chrome via CDP. */
  external: boolean;
};

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CHROME_PROFILE = join(PACKAGE_ROOT, 'output', '.chrome-profile');

export type LaunchOptions = {
  headed: boolean;
  /** Persistent Chrome profile directory (builds trust over runs). */
  userDataDir?: string;
  /** Attach to Chrome started with --remote-debugging-port, e.g. http://127.0.0.1:9222 */
  cdpUrl?: string;
};

/**
 * Launch or attach Chrome for eXp scraping.
 *
 * Captcha path: reCAPTCHA Enterprise *invisible*. Tokens come from
 * grecaptcha.enterprise.execute in-page. Playwright automation is often
 * scored as a bot — prefer a persistent profile or CDP-attach to a manual
 * Chrome session so scores stay usable.
 */
export async function launchExpBrowser(options: LaunchOptions): Promise<ExpBrowser> {
  if (options.cdpUrl) {
    const browser = await chromium.connectOverCDP(options.cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { browser, context, page, external: true };
  }

  const userDataDir = options.userDataDir ?? DEFAULT_CHROME_PROFILE;
  mkdirSync(userDataDir, { recursive: true });

  // Persistent context + fewer automation tells. Do NOT spoof an old UA —
  // that mismatches the real Chrome binary and tanks Enterprise scores.
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: !options.headed,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
    ],
    slowMo: options.headed ? 15 : 0,
  });

  // Soften webdriver flag for in-page checks.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = context.pages()[0] ?? (await context.newPage());
  return { browser: context.browser()!, context, page, external: false };
}

export async function dismissCookies(page: Page): Promise<void> {
  for (const sel of [
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler',
  ]) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    try {
      await el.click({ timeout: 1500 });
      await page.waitForTimeout(400);
      return;
    } catch {
      // ignore
    }
  }
}

/** Light human-like mouse motion before captcha execute / GraphQL. */
export async function humanizePage(page: Page): Promise<void> {
  const box = page.viewportSize() ?? { width: 1440, height: 1000 };
  const x = 200 + Math.floor(Math.random() * (box.width - 400));
  const y = 160 + Math.floor(Math.random() * 240);
  await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 10) });
  await page.waitForTimeout(200 + Math.floor(Math.random() * 400));
}

export async function openCountryPage(page: Page, country: CountryCode): Promise<void> {
  const url = COUNTRY_URLS[country];
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000 + Math.floor(Math.random() * 1000));
  await dismissCookies(page);
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { grecaptcha?: { enterprise?: { execute?: unknown } } }).grecaptcha
          ?.enterprise?.execute,
      ),
    { timeout: 30000 },
  );
  await humanizePage(page);
  await page.waitForTimeout(800 + Math.floor(Math.random() * 700));
}

export async function closeExpBrowser(session: ExpBrowser): Promise<void> {
  if (session.external) {
    // Leave the user's Chrome running; only disconnect.
    await session.browser.close().catch(() => {});
    return;
  }
  await session.context.close().catch(() => {});
}

/** Block until the operator presses Enter (headed / CDP recovery). */
export async function waitForHuman(message: string): Promise<void> {
  console.warn(`\n[captcha] ${message}`);
  console.warn('[captcha] Interact with the Chrome window if needed, then press Enter here to continue…');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question('> ', () => {
      rl.close();
      resolve();
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepWithJitter(ms: number): Promise<void> {
  const jitter = Math.floor(ms * 0.25 * Math.random());
  return sleep(ms + jitter);
}
