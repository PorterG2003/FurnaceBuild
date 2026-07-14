import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CsvRow = Record<string, string>;

export const DEFAULT_STAGE3_CSV =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/stage1-live/stage3_webinar_host_entities.csv';

export const SAMPLE_NAMES = [
  'Supermetrics',
  'Xtalks',
  'Commvault',
  'GWC Data.AI',
  'Instinct Science',
  'Behavioral Health Business',
  'CurvUp',
  'Henry Smith Foundation',
];

export const PILOT_VALIDATION_DOMAINS = [
  'nike.com',
  'zendesk.com',
  'google.com',
  'deel.com',
  'supermetrics.com',
  'microsoft.com',
  'linkedin.com',
];

export const SANITY_CHECK_COMPANIES: Array<{ domain: string; companyName: string; expected: 'yes' | 'no' }> = [
  { domain: 'nike.com', companyName: 'Nike', expected: 'yes' },
  { domain: 'google.com', companyName: 'Google', expected: 'yes' },
  { domain: 'zendesk.com', companyName: 'Zendesk', expected: 'yes' },
  { domain: 'supermetrics.com', companyName: 'Supermetrics', expected: 'yes' },
  { domain: 'xtalks.com', companyName: 'Xtalks', expected: 'yes' },
  { domain: 'commvault.com', companyName: 'Commvault', expected: 'no' },
  { domain: 'gwcdata.ai', companyName: 'GWC Data.AI', expected: 'no' },
  {
    domain: 'this-domain-definitely-has-no-ads-xyz123.com',
    companyName: 'Fake Co',
    expected: 'no',
  },
];

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

export function loadCsv(path: string): CsvRow[] {
  const raw = readFileSync(path, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

export function eligibleRows(rows: CsvRow[]): CsvRow[] {
  return rows.filter((r) => r.enrichment_status === 'ok' && r.company_domain?.trim());
}

export function pickSample(rows: CsvRow[], names: string[]): CsvRow[] {
  const byName = new Map(rows.map((r) => [r.company_name, r]));
  return names.map((name) => byName.get(name)).filter((r): r is CsvRow => Boolean(r));
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

export function pickPilotRows(rows: CsvRow[], maxRows: number, seedDomains: string[]): CsvRow[] {
  const eligible = eligibleRows(rows);
  const byDomain = new Map(eligible.map((row) => [row.company_domain.trim(), row]));
  const picked: CsvRow[] = [];
  const seen = new Set<string>();
  for (const domain of seedDomains) {
    const row = byDomain.get(domain);
    if (row && !seen.has(domain)) {
      picked.push(row);
      seen.add(domain);
    }
  }
  const rest = eligible.filter((row) => !seen.has(row.company_domain.trim()));
  shuffleInPlace(rest);
  for (const row of rest) {
    if (picked.length >= maxRows) break;
    picked.push(row);
  }
  return picked.slice(0, maxRows);
}

export function pickRows(
  rows: CsvRow[],
  batchMode: 'sample' | 'all',
  maxRows: number | null,
  pilot: boolean,
): CsvRow[] {
  if (pilot && maxRows != null && maxRows > 0) {
    return pickPilotRows(rows, maxRows, PILOT_VALIDATION_DOMAINS);
  }
  const base = batchMode === 'all' ? eligibleRows(rows) : pickSample(rows, SAMPLE_NAMES);
  if (maxRows != null && maxRows > 0) return base.slice(0, maxRows);
  return base;
}

export function loadPilotRows(maxRows = 150, csvPath?: string): CsvRow[] {
  const resolved = resolve(__dirname, csvPath ?? DEFAULT_STAGE3_CSV);
  const rows = loadCsv(resolved);
  return pickPilotRows(rows, maxRows, PILOT_VALIDATION_DOMAINS);
}

export function loadAllEligibleRows(csvPath?: string): CsvRow[] {
  const resolved = resolve(__dirname, csvPath ?? DEFAULT_STAGE3_CSV);
  return eligibleRows(loadCsv(resolved));
}

export function resolveStage3Csv(csvPath?: string): string {
  return resolve(__dirname, csvPath ?? DEFAULT_STAGE3_CSV);
}
