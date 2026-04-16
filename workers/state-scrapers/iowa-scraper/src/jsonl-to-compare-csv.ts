/**
 * Turn compare JSONL into a spreadsheet-friendly CSV for side-by-side review with the source export.
 *
 * Usage (from iowa-scraper):
 *   npx tsx src/jsonl-to-compare-csv.ts [input.jsonl] [output.csv]
 *
 * Defaults: newest *.jsonl under ./reports, writes alongside input with suffix .readable.csv
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

type Line = {
  index?: number;
  batchIndex?: number;
  sourceDataIndex?: number;
  sourceSpreadsheetRow?: number;
  companyName: string;
  csvPhone?: string;
  csvCity?: string;
  csvContact?: string;
  csvTitle?: string;
  apifyPeopleLowTrust?: boolean;
  rateLimited?: boolean;
  scrapeError?: string;
  hitCount?: number;
  ambiguous?: boolean;
  pickedBusinessNumber?: string | null;
  pickedEntityName?: string | null;
  iowaLegalName?: string | null;
  iowaStatus?: string | null;
  officerNames?: string[];
  registeredAgentName?: string | null;
  legalNameRoughMatch?: string;
  contactVsOfficers?: {
    outcome: string;
    reason: string;
    namesFound?: string[];
    expectedNormalized?: string;
  };
};

function main() {
  const reportsDir = path.resolve(__dirname, '../reports');
  let inPath = process.argv[2];
  if (!inPath) {
    const files = readdirSync(reportsDir)
      .filter((f) => f.endsWith('.jsonl') && f.startsWith('iowa-csv-compare-'))
      .map((f) => {
        const m = path.join(reportsDir, f);
        return { f, m, t: statSync(m).mtimeMs };
      })
      .sort((a, b) => b.t - a.t);
    if (files.length === 0) {
      console.error('No iowa-csv-compare-*.jsonl under reports/. Pass input path explicitly.');
      process.exit(1);
    }
    inPath = files[0].m;
  } else {
    inPath = path.resolve(process.cwd(), inPath);
  }

  let outPath = process.argv[3];
  if (!outPath) {
    outPath = inPath.replace(/\.jsonl$/i, '.readable.csv');
  } else {
    outPath = path.resolve(process.cwd(), outPath);
  }

  const raw = readFileSync(inPath, 'utf8').trim();
  const lines = raw ? raw.split('\n') : [];

  const header = [
    'Run #',
    'Source CSV row (1-based)',
    'Source data index (0-based)',
    'Company Name (CSV)',
    'CSV City',
    'CSV Phone',
    'CSV Contact (Apify)',
    'CSV Title',
    'Apify people low trust',
    'Iowa hit count',
    'Iowa picked # (search)',
    'Iowa picked name (search)',
    'Iowa legal name (summary)',
    'Iowa status',
    'Iowa officers (semicolon-separated)',
    'Iowa registered agent',
    'Legal name rough match',
    'Contact vs Iowa outcome',
    'Contact vs Iowa reason',
    'Names Iowa used for compare',
    'Expected name (normalized)',
    'Scrape error',
    'Rate limited',
  ];

  const out: string[] = [row(header)];

  for (const line of lines) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Line;
    const c = o.contactVsOfficers;
    const runNum = (o.batchIndex ?? o.index ?? 0) + 1;
    out.push(
      row([
        runNum,
        o.sourceSpreadsheetRow ?? '',
        o.sourceDataIndex ?? '',
        o.companyName,
        o.csvCity ?? '',
        o.csvPhone ?? '',
        o.csvContact ?? '',
        o.csvTitle ?? '',
        o.apifyPeopleLowTrust ? 'yes' : 'no',
        o.hitCount ?? 0,
        o.pickedBusinessNumber ?? '',
        o.pickedEntityName ?? '',
        o.iowaLegalName ?? '',
        o.iowaStatus ?? '',
        (o.officerNames ?? []).join('; '),
        o.registeredAgentName ?? '',
        o.legalNameRoughMatch ?? '',
        c?.outcome ?? '',
        c?.reason ?? '',
        (c?.namesFound ?? []).join('; '),
        c?.expectedNormalized ?? '',
        o.scrapeError ?? '',
        o.rateLimited ? 'yes' : 'no',
      ]),
    );
  }

  writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
  console.log(JSON.stringify({ input: inPath, output: outPath, rows: out.length - 1 }, null, 2));
}

main();
