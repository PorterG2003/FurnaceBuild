/**
 * Batch Iowa SOS scrape for companies in a CSV; compare registry names to Apify "people" name.
 *
 * **Testing / baseline only** — not production. The name list fed to `compareToExpectedPerson` is
 * **officer names plus registered agent when present** (broader than `ownerRowsForIowaDetail`, which
 * persists officers only). Use that to gauge recall vs CSV contacts; persistence policy lives in
 * `@furnace/registry-server` (`ownerRowsForIowaDetail` + `persistIowaRegistryPull`).
 *
 * Usage:
 *   npm run compare-csv -- [path/to.csv]
 *   MAX_ROWS=50 RATE_MS=5000 npm run compare-csv
 *
 * Only **Iowa** rows with a non-empty **Name - People - Results** are scraped and compared
 * (saves Iowa traffic and matches “compare only where we have a CSV name”).
 *
 * Rate limits (bird / captcha page): handled via retries + backoff in `iowaBrowser.ts`.
 * After a rate-limit event, an extra cooldown runs (IOWA_POST_RATELIMIT_COOLDOWN_MS, default 120000).
 *
 * Rate-limit tuning (see also `src/iowaRateLimit.ts`):
 *   IOWA_RATELIMIT_RETRIES — full scrape attempts per company (default 4, max 12)
 *   IOWA_RATELIMIT_BACKOFF_BASE_MS, IOWA_RATELIMIT_BACKOFF_STEP_MS, IOWA_RATELIMIT_BACKOFF_CAP_MS
 *
 * Output: reports/iowa-csv-compare-<iso>.jsonl + .summary.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  compareToExpectedPerson,
  normalizeBusinessName,
} from '@furnace/registry-server';
import { scrapeIowaCompanyFromSearchForm } from './iowaBrowser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CSV = path.resolve(
  __dirname,
  '../../../../Home-Builders-(Apify-Accounts)-Default-view-export-1776315696576.csv',
);

type CsvRow = Record<string, string>;

function legalNameRoughMatch(csvCompany: string, iowaLegal?: string | null): 'yes' | 'weak' | 'no' {
  if (!iowaLegal?.trim()) return 'no';
  const a = normalizeBusinessName(csvCompany);
  const b = normalizeBusinessName(iowaLegal);
  if (!a || !b) return 'no';
  if (a === b || a.includes(b) || b.includes(a)) return 'yes';
  const tokens = a.split(' ').filter((t) => t.length > 2);
  let overlap = 0;
  for (const t of tokens) {
    if (b.includes(t)) overlap += 1;
  }
  if (overlap >= 2) return 'weak';
  return 'no';
}

function apifyPeopleLowTrust(row: CsvRow): boolean {
  const jobCol = row['Find people at company by job title'] ?? '';
  return /Found 10 people/i.test(jobCol);
}

async function main() {
  const csvPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_CSV;
  const maxRows = Number(process.env.MAX_ROWS ?? '') || 0;
  const rateMs = Number(process.env.RATE_MS ?? '5000');
  const postRateLimitCooldownMs = Number(process.env.IOWA_POST_RATELIMIT_COOLDOWN_MS ?? '120000');
  const raw = readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as CsvRow[];

  const slice = maxRows > 0 ? rows.slice(0, maxRows) : rows;

  const isIowa = (r: CsvRow) => /^(iowa|ia)$/i.test((r.state ?? '').trim());
  const hasContactName = (r: CsvRow) => (r['Name - People - Results'] ?? '').trim().length > 0;

  let skipped_non_iowa = 0;
  let skipped_no_contact_name = 0;
  const candidates: { row: CsvRow; sourceDataIndex: number }[] = [];
  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (!isIowa(row)) {
      skipped_non_iowa += 1;
      continue;
    }
    if (!hasContactName(row)) {
      skipped_no_contact_name += 1;
      continue;
    }
    candidates.push({ row, sourceDataIndex: i });
  }

  const reportDir = path.resolve(__dirname, '../reports');
  await mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonlPath = path.join(reportDir, `iowa-csv-compare-${stamp}.jsonl`);
  const summaryPath = path.join(reportDir, `iowa-csv-compare-${stamp}.summary.json`);

  const jsonlLines: string[] = [];

  const counts = {
    rows_scraped: 0,
    skipped_non_iowa,
    skipped_no_contact_name,
    errors: 0,
    no_registry_hit: 0,
    ambiguous_pick: 0,
    compare_match: 0,
    compare_partial: 0,
    compare_no_match: 0,
    compare_skipped: 0,
    legal_yes: 0,
    legal_weak: 0,
    legal_no: 0,
    rate_limit_exhausted: 0,
  };

  const headless = process.env.IOWA_HEADLESS === '1';
  const browser = await chromium.launch({
    headless,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);

  try {
    for (let i = 0; i < candidates.length; i++) {
      const { row, sourceDataIndex } = candidates[i];

      if (i > 0 && rateMs > 0) {
        await new Promise((r) => setTimeout(r, rateMs + Math.floor(Math.random() * 400)));
      }

      const companyName = (row['Company Name'] ?? '').trim();
      const csvContact = (row['Name - People - Results'] ?? '').trim();
      const csvTitle = (row['Title - People - Results'] ?? '').trim();
      const csvPhone = (row.phone ?? '').trim();

      if (!companyName) continue;

      const scrape = await scrapeIowaCompanyFromSearchForm(page, companyName);
      counts.rows_scraped += 1;

      if (scrape.error === 'iowa_rate_limit_exhausted_retries') {
        counts.rate_limit_exhausted += 1;
      }
      if (scrape.rateLimited || /iowa_rate_limit/.test(scrape.error ?? '')) {
        console.error(
          JSON.stringify({
            iowaPostRateLimitCooldownMs: postRateLimitCooldownMs,
            company: companyName,
            scrapeError: scrape.error,
          }),
        );
        await new Promise((r) => setTimeout(r, postRateLimitCooldownMs));
      }

      const scrapedForCompare = [
        ...scrape.officerNames,
        ...(scrape.registeredAgentName ? [scrape.registeredAgentName] : []),
      ];
      const personCompare = compareToExpectedPerson(scrapedForCompare, csvContact);
      if (personCompare.outcome === 'match') counts.compare_match += 1;
      else if (personCompare.outcome === 'partial') counts.compare_partial += 1;
      else if (personCompare.outcome === 'no_match') counts.compare_no_match += 1;
      else counts.compare_skipped += 1;

      const legal = legalNameRoughMatch(companyName, scrape.detail?.legalName ?? null);
      if (legal === 'yes') counts.legal_yes += 1;
      else if (legal === 'weak') counts.legal_weak += 1;
      else counts.legal_no += 1;

      if (scrape.error) counts.errors += 1;
      if (!scrape.pick.hit) counts.no_registry_hit += 1;
      if (scrape.pick.ambiguous) counts.ambiguous_pick += 1;

      const line = {
        batchIndex: i,
        sourceDataIndex,
        /** 1-based spreadsheet row in the source CSV (header = row 1). */
        sourceSpreadsheetRow: sourceDataIndex + 2,
        companyName,
        csvPhone,
        csvCity: row.city ?? '',
        csvContact,
        csvTitle,
        apifyPeopleLowTrust: apifyPeopleLowTrust(row),
        scrapeError: scrape.error,
        rateLimited: Boolean(scrape.rateLimited),
        hitCount: scrape.hits.length,
        ambiguous: scrape.pick.ambiguous,
        pickedBusinessNumber: scrape.pick.hit?.businessNumber ?? null,
        pickedEntityName: scrape.pick.hit?.entityName ?? null,
        iowaLegalName: scrape.detail?.legalName ?? null,
        iowaStatus: scrape.detail?.status ?? null,
        officerNames: scrape.officerNames,
        registeredAgentName: scrape.registeredAgentName ?? null,
        legalNameRoughMatch: legal,
        contactVsOfficers: personCompare,
      };

      jsonlLines.push(JSON.stringify(line));

      if ((i + 1) % 25 === 0 || i + 1 === candidates.length) {
        console.error(
          JSON.stringify({ progress: i + 1, total: candidates.length, company: companyName }),
        );
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(jsonlPath, `${jsonlLines.join('\n')}\n`, 'utf8');

  const summary = {
    generatedAt: new Date().toISOString(),
    csvPath,
    jsonlPath,
    maxRows: maxRows || null,
    rateMs,
    namedIowaRowCount: candidates.length,
    counts,
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
