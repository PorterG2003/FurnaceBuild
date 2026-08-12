import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { extractLandingPeople } from './landingPeople.js';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';

export const LANDING_PEOPLE_COLUMNS = [
  'ad_id',
  'company_name',
  'company_domain',
  'platform',
  'landing_url',
  'person_name',
  'evidence',
  'source',
  'status',
  'error',
  'ad_library_url',
] as const;

async function fetchLandingText(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(800);
    // Expand common "read more" / FAQ toggles lightly
    await page
      .locator('button, [role="button"]')
      .evaluateAll((nodes) => {
        for (const node of nodes.slice(0, 8)) {
          const t = (node as HTMLElement).innerText?.trim() || '';
          if (/^(?:…\s*)?(see|show|read)\s+more$/i.test(t)) {
            (node as HTMLElement).click();
          }
        }
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    const body = await page.locator('body').innerText().catch(() => '');
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).textContent || '').join('\n'))
      .catch(() => '');
    return `${body}\n${jsonLd}`.slice(0, 80_000);
  } finally {
    await page.close();
  }
}

/**
 * Playwright-scrape landing pages and extract host/speaker names.
 */
export async function scrapeLandingPeople(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  headless?: boolean;
}): Promise<{ path: string; people: number; pages: number }> {
  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'landing_people.csv');
  const checkpointPath = join(outDir, 'landing_scrape_checkpoint.json');

  let rows = readCsv(options.inputCsv).filter((r) => (r.scrape_url || r.landing_url || '').trim());
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      pages: rows.length,
      note: 'Playwright landing scrape only — no paid APIs.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'landing_scrape_dry_run.json'), estimate);
    return { path: outPath, people: 0, pages: 0 };
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

    for (let i = checkpoint.next_index; i < rows.length; i++) {
      const row = rows[i]!;
      const url = (row.scrape_url || row.landing_url || '').trim();
      console.error(`[landing] ${i + 1}/${rows.length} ${row.company_name} → ${url}`);

      let text = '';
      let error = '';
      try {
        text = await fetchLandingText(browser, url);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const people = text
        ? extractLandingPeople(text, { companyName: row.company_name })
        : [];

      if (people.length === 0) {
        checkpoint.results.push({
          ad_id: row.ad_id ?? '',
          company_name: row.company_name ?? '',
          company_domain: row.company_domain ?? '',
          platform: row.platform ?? '',
          landing_url: url,
          person_name: '',
          evidence: '',
          source: '',
          status: error ? 'error' : 'no_people',
          error,
          ad_library_url: row.ad_library_url ?? '',
        });
      } else {
        for (const p of people.slice(0, 5)) {
          checkpoint.results.push({
            ad_id: row.ad_id ?? '',
            company_name: row.company_name ?? '',
            company_domain: row.company_domain ?? '',
            platform: row.platform ?? '',
            landing_url: url,
            person_name: p.person_name,
            evidence: p.evidence,
            source: p.source,
            status: 'found',
            error: '',
            ad_library_url: row.ad_library_url ?? '',
          });
        }
      }

      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      writeCsv(outPath, checkpoint.results, [...LANDING_PEOPLE_COLUMNS]);
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    if (browser) await browser.close();
  }

  const people = checkpoint.results.filter((r) => r.status === 'found' && r.person_name).length;
  const pages = new Set(checkpoint.results.map((r) => r.ad_id)).size;
  writeJson(join(outDir, 'landing_scrape_tally.json'), {
    pages,
    people_found: people,
    no_people: checkpoint.results.filter((r) => r.status === 'no_people').length,
    errors: checkpoint.results.filter((r) => r.status === 'error').length,
  });
  console.log(JSON.stringify({ done: true, pages, people_found: people }, null, 2));
  return { path: outPath, people, pages };
}
