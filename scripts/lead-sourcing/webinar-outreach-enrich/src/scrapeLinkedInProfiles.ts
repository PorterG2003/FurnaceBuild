import { chromium, type Browser, type Page } from 'playwright';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { normalizeLinkedInProfileUrl } from './pass5Prep.js';

export const LINKEDIN_PROFILE_COLUMNS = [
  'ad_id',
  'company_name',
  'company_domain',
  'platform',
  'person_name',
  'linkedin_url',
  'headline',
  'company',
  'profile_source',
  'status',
  'error',
  'serper_title',
  'serper_snippet',
  'ad_library_url',
] as const;

/** Parse headline/company hints from a Serper LinkedIn title like "Name - Title at Company | LinkedIn". */
export function parseSerperLinkedInTitle(title: string): { headline: string; company: string } {
  let t = (title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  // "Name - Rest"
  const dash = t.match(/^(.{2,60}?)\s[-–—]\s(.+)$/);
  if (dash) t = dash[2]!.trim();
  const at = t.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) {
    return { headline: at[1]!.trim(), company: at[2]!.trim() };
  }
  return { headline: t, company: '' };
}

async function scrapePublicProfile(
  page: Page,
  url: string,
): Promise<{ headline: string; company: string; loginWall: boolean }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText().catch(() => '');
  const loginWall =
    /sign in|join now|authwall|login to linkedin|agree.?&.?join/i.test(body) &&
    !/experience|about|activity/i.test(body.slice(0, 2000));

  // Try common public selectors / meta
  const headline =
    (await page
      .locator('h2, .top-card-layout__headline, [data-generated-suggestion-target] + div')
      .first()
      .innerText()
      .catch(() => '')) ||
    (await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => '')) ||
    '';

  const company =
    (await page
      .locator('[data-field="experience_company_name"], .experience-item__title, a[data-field="experience_company_logo"]')
      .first()
      .innerText()
      .catch(() => '')) || '';

  // Fallback: first non-empty line after name-looking h1
  let headline2 = headline.trim();
  if (!headline2) {
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // Often: Name, Headline, Location
    if (lines.length >= 2 && lines[1]!.length > 3 && lines[1]!.length < 180) {
      headline2 = lines[1]!;
    }
  }

  return {
    headline: headline2.slice(0, 200),
    company: company.trim().slice(0, 120),
    loginWall,
  };
}

/**
 * Scrape LinkedIn public profiles; fall back to Serper title/snippet on login wall.
 */
export async function scrapeLinkedInProfiles(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  headless?: boolean;
}): Promise<{ path: string; scraped: number; fallback: number }> {
  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'linkedin_profiles.csv');
  const checkpointPath = join(outDir, 'profile_scrape_checkpoint.json');

  let rows = readCsv(options.inputCsv).filter((r) =>
    normalizeLinkedInProfileUrl(r.linkedin_url || ''),
  );
  // Prefer stronger candidates first but keep weak too
  rows = rows.filter((r) => r.status === 'candidate' || r.status === 'weak_candidate' || r.linkedin_url);
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      profiles: rows.length,
      note: 'Playwright LI scrape; Serper title fallback on authwall — no paid APIs.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'profile_scrape_dry_run.json'), estimate);
    return { path: outPath, scraped: 0, fallback: 0 };
  }

  type Result = Record<string, string>;
  type Checkpoint = { next_index: number; results: Result[] };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? { next_index: 0, results: [] };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: options.headless !== false,
      channel: process.platform === 'darwin' ? 'chrome' : undefined,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    for (let i = checkpoint.next_index; i < rows.length; i++) {
      const row = rows[i]!;
      const url = normalizeLinkedInProfileUrl(row.linkedin_url || '');
      console.error(`[profile] ${i + 1}/${rows.length} ${row.person_name} → ${url}`);

      let headline = '';
      let company = '';
      let profile_source = '';
      let status = '';
      let error = '';

      try {
        const scraped = await scrapePublicProfile(page, url);
        if (scraped.loginWall || (!scraped.headline && !scraped.company)) {
          const parsed = parseSerperLinkedInTitle(row.serper_title || '');
          headline = scraped.headline || parsed.headline || (row.serper_snippet || '').slice(0, 160);
          company = scraped.company || parsed.company;
          profile_source = 'serper_snippet';
          status = headline || company ? 'fallback' : 'empty';
        } else {
          headline = scraped.headline;
          company = scraped.company;
          profile_source = 'playwright';
          status = 'scraped';
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        const parsed = parseSerperLinkedInTitle(row.serper_title || '');
        headline = parsed.headline || (row.serper_snippet || '').slice(0, 160);
        company = parsed.company;
        profile_source = 'serper_snippet';
        status = headline || company ? 'fallback' : 'error';
      }

      checkpoint.results.push({
        ad_id: row.ad_id ?? '',
        company_name: row.company_name ?? '',
        company_domain: row.company_domain ?? '',
        platform: row.platform ?? '',
        person_name: row.person_name ?? '',
        linkedin_url: url,
        headline,
        company,
        profile_source,
        status,
        error,
        serper_title: row.serper_title ?? '',
        serper_snippet: row.serper_snippet ?? '',
        ad_library_url: row.ad_library_url ?? '',
      });
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      writeCsv(outPath, checkpoint.results, [...LINKEDIN_PROFILE_COLUMNS]);
      await page.waitForTimeout(400);
    }

    await page.close();
  } finally {
    if (browser) await browser.close();
  }

  const scraped = checkpoint.results.filter((r) => r.status === 'scraped').length;
  const fallback = checkpoint.results.filter((r) => r.status === 'fallback').length;
  writeJson(join(outDir, 'profile_scrape_tally.json'), {
    attempted: checkpoint.results.length,
    scraped,
    fallback,
    empty: checkpoint.results.filter((r) => r.status === 'empty').length,
  });
  console.log(JSON.stringify({ done: true, scraped, fallback }, null, 2));
  return { path: outPath, scraped, fallback };
}
