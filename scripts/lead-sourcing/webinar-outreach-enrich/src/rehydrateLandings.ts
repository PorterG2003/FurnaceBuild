import { chromium, type Browser, type Page } from 'playwright';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { normalizeDomain } from './types.js';

export type RehydrateResult = {
  ad_id: string;
  company_name: string;
  platform: string;
  person_name: string;
  source_url: string;
  href: string;
  normalized_domain: string;
  status: string;
  error: string;
  ad_library_url: string;
};

const COLUMNS = [
  'ad_id',
  'company_name',
  'platform',
  'person_name',
  'source_url',
  'href',
  'normalized_domain',
  'status',
  'error',
  'ad_library_url',
] as const;

const CTA_TEXT_RE =
  /\b(?:register|sign\s*up|learn\s*more|get\s*tickets?|book\s*now|apply\s*now|reserve|save\s*your|join\s*(?:us|now|free)|claim|enroll|rsvp|get\s*access|watch|attend)\b/i;

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Unwrap Meta tracking redirects to the destination URL. */
export function unwrapTrackingRedirect(href: string): string {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (host === 'l.facebook.com' || host === 'lm.facebook.com') {
      const nested = u.searchParams.get('u');
      if (nested) return unwrapTrackingRedirect(decodeURIComponent(nested));
    }
  } catch {
    return href;
  }
  return href;
}

function isChromeHref(href: string): boolean {
  const host = hostOf(href);
  if (!host) return true;
  if (
    /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|meta\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|metastatus\.com)$/i.test(
      host,
    )
  ) {
    return true;
  }
  if (/about\.meta\.com|transparency\.fb\.com|developers\.facebook\.com/i.test(host)) {
    return true;
  }
  return false;
}

function isExternalHref(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  return !isChromeHref(href);
}

export function pickCtaHref(
  links: Array<{ href: string; text: string }>,
): string {
  const unwrapped = links.map((l) => ({
    href: unwrapTrackingRedirect(l.href),
    text: l.text,
  }));
  const external = unwrapped.filter((l) => isExternalHref(l.href));
  if (external.length === 0) return '';
  const withBrand = external.filter((l) => Boolean(normalizeDomain(l.href)));
  const pool = withBrand.length ? withBrand : external;
  const webinarish = pool.filter((l) =>
    /webinar|register|event|summit|rsvp/i.test(`${l.href} ${l.text}`),
  );
  const ctaPool = webinarish.length ? webinarish : pool;
  const cta = ctaPool.find((l) => CTA_TEXT_RE.test(l.text.trim()));
  return (cta || ctaPool[0])!.href;
}

async function dismissNoise(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /allow all cookies|accept all|allow essential|accept/i }).first(),
    page.getByRole('button', { name: /not now|dismiss|close/i }).first(),
  ];
  for (const loc of candidates) {
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }
}

async function collectLinks(page: Page): Promise<Array<{ href: string; text: string }>> {
  return page.locator('a[href^="http"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const a = node as HTMLAnchorElement;
      return { href: a.href, text: (a.innerText || a.textContent || '').trim().slice(0, 120) };
    }),
  );
}

async function expandSeeMore(page: Page): Promise<void> {
  await page
    .locator('button, [role="button"]')
    .evaluateAll((nodes) => {
      const candidate = nodes.find((node) =>
        /^(?:…\s*)?(see|show)\s+more$/i.test((node as HTMLElement).innerText.trim()),
      );
      if (!candidate) return false;
      (candidate as HTMLElement).click();
      return true;
    })
    .catch(() => false);
  await page.waitForTimeout(400);
}

async function extractHrefFromLibrary(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissNoise(page);
  await page.waitForTimeout(800);
  await expandSeeMore(page);

  let links = await collectLinks(page);
  let href = pickCtaHref(links);
  if (href) return href;

  // Meta: try clicking into "See ad details" / open dropdown if present
  const detailBtn = page.getByRole('button', { name: /see ad details|see summary details|open dropdown/i }).first();
  if (await detailBtn.isVisible().catch(() => false)) {
    await detailBtn.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    links = await collectLinks(page);
    href = pickCtaHref(links);
    if (href) return href;
  }

  // Fallback: any external http link including ones that look like destinations in data attrs
  const dataLanding = await page
    .locator('[data-landing-url], [href*="l.facebook.com/l.php"]')
    .evaluateAll((nodes) => {
      const out: string[] = [];
      for (const node of nodes) {
        const el = node as HTMLElement;
        const data = el.getAttribute('data-landing-url');
        if (data) out.push(data);
        const hrefAttr = el.getAttribute('href');
        if (hrefAttr?.includes('l.facebook.com/l.php')) {
          try {
            const u = new URL(hrefAttr, 'https://www.facebook.com');
            const nested = u.searchParams.get('u');
            if (nested) out.push(decodeURIComponent(nested));
          } catch {
            /* ignore */
          }
        }
      }
      return out;
    })
    .catch(() => [] as string[]);

  for (const candidate of dataLanding) {
    if (isExternalHref(candidate)) return candidate;
  }

  return '';
}

/**
 * Open Ad Library URLs and pull external CTA hrefs (links not spelled in copy).
 */
export async function rehydrateLandings(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  headless?: boolean;
}): Promise<{ path: string; recovered: number; attempted: number }> {
  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'rehydrated_landings.csv');
  const checkpointPath = join(outDir, 'rehydrate_checkpoint.json');

  let rows = readCsv(options.inputCsv).filter((r) => (r.ad_library_url || '').trim());
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      candidates: rows.length,
      note: 'Playwright Ad Library href pull only — no paid APIs.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'rehydrate_dry_run.json'), estimate);
    return { path: outPath, recovered: 0, attempted: 0 };
  }

  type Checkpoint = { next_index: number; results: RehydrateResult[] };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? { next_index: 0, results: [] };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: options.headless !== false,
      channel: process.platform === 'darwin' ? 'chrome' : undefined,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

    for (let i = checkpoint.next_index; i < rows.length; i++) {
      const row = rows[i]!;
      const libraryUrl = (row.ad_library_url || '').trim();
      console.error(`[rehydrate] ${i + 1}/${rows.length} ${row.company_name}`);

      let href = '';
      let error = '';
      try {
        href = await extractHrefFromLibrary(page, libraryUrl);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const domain = href ? normalizeDomain(href) : '';
      const status = href
        ? domain
          ? 'recovered'
          : 'generic_or_stripped'
        : error
          ? 'error'
          : 'no_href';

      const result: RehydrateResult = {
        ad_id: row.ad_id ?? '',
        company_name: row.company_name ?? '',
        platform: row.platform ?? '',
        person_name: row.person_name ?? '',
        source_url: libraryUrl,
        href,
        normalized_domain: domain,
        status,
        error,
        ad_library_url: libraryUrl,
      };
      checkpoint.results.push(result);
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      writeCsv(outPath, checkpoint.results, [...COLUMNS]);
      await page.waitForTimeout(400);
    }

    await page.close();
  } finally {
    if (browser) await browser.close();
  }

  const recovered = checkpoint.results.filter((r) => r.status === 'recovered').length;
  const generic = checkpoint.results.filter((r) => r.status === 'generic_or_stripped').length;
  writeJson(join(outDir, 'rehydrate_tally.json'), {
    attempted: checkpoint.results.length,
    recovered,
    generic_or_stripped: generic,
    no_href: checkpoint.results.filter((r) => r.status === 'no_href').length,
    error: checkpoint.results.filter((r) => r.status === 'error').length,
  });
  console.log(
    JSON.stringify(
      { done: true, attempted: checkpoint.results.length, recovered, generic },
      null,
      2,
    ),
  );
  return { path: outPath, recovered, attempted: checkpoint.results.length };
}
