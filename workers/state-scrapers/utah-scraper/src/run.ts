/**
 * Utah entity scrape + compare to UtahLLCOwnerSearchTester.csv
 * Usage: npx tsx src/run.ts [path/to.csv] [--out report.json]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import type { CsvRow } from './browser.js';
import { scrapeUtahRow } from './browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const argv = process.argv.slice(2);
  let csvPath =
    process.env.INPUT_CSV?.trim() ||
    path.resolve(__dirname, '../../../../UtahLLCOwnerSearchTester.csv');
  let outJson =
    process.env.OUTPUT_JSON?.trim() || path.resolve(process.cwd(), 'utah-scrape-report.json');
  let outCsv: string | null = outJson.replace(/\.json$/i, '.csv');
  let maxRows = Number(process.env.MAX_ROWS ?? '') || 0;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      outJson = path.resolve(process.cwd(), argv[++i]);
      outCsv = outJson.replace(/\.json$/i, '.csv');
    } else if (argv[i] === '--max' && argv[i + 1]) {
      maxRows = Number(argv[++i]) || 0;
    } else if (!argv[i].startsWith('-')) {
      csvPath = path.resolve(process.cwd(), argv[i]);
    }
  }

  return { csvPath, outJson, outCsv, maxRows };
}

async function main() {
  const { csvPath, outJson, outCsv, maxRows } = parseArgs();
  const raw = readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as CsvRow[];

  const slice = maxRows > 0 ? rows.slice(0, maxRows) : rows;
  const rateMs = Number(process.env.RATE_MS ?? '2000');
  const rawDir = process.env.SAVE_RAW_HTML_DIR?.trim();

  if (rawDir) {
    await mkdir(rawDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  const results: Awaited<ReturnType<typeof scrapeUtahRow>>[] = [];

  for (let i = 0; i < slice.length; i++) {
    if (i > 0 && rateMs > 0) {
      await new Promise((r) => setTimeout(r, rateMs + Math.floor(Math.random() * 500)));
    }
    const row = slice[i];
    const r = await scrapeUtahRow(page, row, { isFirst: i === 0 });
    results.push(r);
    console.log(JSON.stringify({ i, csvId: r.csvId, outcome: r.compareOutcome, error: r.error }));

    if (rawDir && (r.error || r.compareOutcome === 'no_match')) {
      const safe = r.csvId || `row-${i}`;
      await writeFile(path.join(rawDir, `${safe}-page.html`), await page.content(), 'utf8');
    }
  }

  await browser.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    csvPath,
    rowCount: results.length,
    byOutcome: results.reduce(
      (acc, r) => {
        acc[r.compareOutcome] = (acc[r.compareOutcome] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    rows: results,
  };

  await writeFile(outJson, JSON.stringify(summary, null, 2), 'utf8');

  const csvHeader =
    'csvId,companyName,searchQuery,entityNumber,entityName,memberNames,compareOutcome,compareReason,ambiguous,error\n';
  const csvBody = results
    .map((r) =>
      [
        r.csvId,
        r.companyName,
        r.searchQuery,
        r.entityNumber,
        r.entityName,
        `"${(r.memberNames || []).join('; ').replace(/"/g, '""')}"`,
        r.compareOutcome,
        r.compareReason,
        r.ambiguous,
        r.error ?? '',
      ].join(','),
    )
    .join('\n');
  if (outCsv) {
    await writeFile(outCsv, csvHeader + csvBody + '\n', 'utf8');
  }

  console.log('Wrote', outJson, outCsv ?? '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
