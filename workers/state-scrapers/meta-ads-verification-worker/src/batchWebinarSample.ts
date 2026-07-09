import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMetaAdLibraryLookup } from './metaAdLibraryLookup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/stage1-live/stage3_webinar_host_entities.csv';

type CsvRow = Record<string, string>;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function loadCsv(path: string): CsvRow[] {
  const raw = readFileSync(path, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

function pickSample(rows: CsvRow[], names: string[]): CsvRow[] {
  const byName = new Map(rows.map((r) => [r.company_name, r]));
  return names.map((name) => byName.get(name)).filter((r): r is CsvRow => Boolean(r));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const headless = process.argv.includes('--headless');
  const csvPath = resolve(__dirname, args[0] ?? DEFAULT_CSV);
  const rows = loadCsv(csvPath).filter(
    (r) => r.enrichment_status === 'ok' && r.company_domain?.trim(),
  );

  const sampleNames = [
    'Supermetrics',
    'Xtalks',
    'Commvault',
    'GWC Data.AI',
    'Instinct Science',
    'Behavioral Health Business',
    'CurvUp',
    'Henry Smith Foundation',
  ];
  const sample = pickSample(rows, sampleNames);
  if (sample.length === 0) throw new Error('No sample rows found');

  const outDir = resolve(__dirname, '../../../../tmp/meta-ads-webinar-batch');
  mkdirSync(outDir, { recursive: true });
  const results: Record<string, unknown>[] = [];

  for (const row of sample) {
    const domain = row.company_domain.trim();
    const companyName = row.company_name.trim();
    process.stderr.write(`Looking up ${companyName} (${domain})...\n`);
    const result = await runMetaAdLibraryLookup({
      domain,
      companyName,
      headless,
      timeoutMs: 45_000,
      outputDir: outDir,
    });
    results.push({
      company_name: companyName,
      company_domain: domain,
      employee_count: row.employee_count,
      industry: row.industry,
      post_count: row.post_count,
      meta_ads_result: result.result,
      matched_page_name: result.matched_page_name,
      matched_via: result.signals.matched_via ?? null,
      matched_ad_count: result.signals.matched_ad_count ?? 0,
      top_ad_primary_text: (result.signals.top_ad as { primary_text?: string | null } | null)?.primary_text ?? null,
      top_ad_landing_url: (result.signals.top_ad as { landing_url?: string | null } | null)?.landing_url ?? null,
      search_attempts: result.signals.search_attempts,
      error: result.error ?? null,
      elapsed_ms: result.lookup_stats.elapsed_ms,
    });
  }

  const outPath = resolve(outDir, 'webinar-batch-results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output: outPath, count: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
