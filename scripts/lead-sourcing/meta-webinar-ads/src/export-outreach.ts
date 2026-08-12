import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureRunDir, writeCsv } from './io.js';

const OUTREACH_COLUMNS = [
  'platform',
  'company_name',
  'company_url',
  'landing_url',
  'landing_domain',
  'person_name',
  'ad_library_url',
  'ad_id',
  'ad_headline',
  'ad_copy',
  'ad_active_from',
  'phrases_found',
  'qualifying_ad_count',
  'source_runs',
] as const;

type OutreachRow = Record<(typeof OUTREACH_COLUMNS)[number], string>;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      current = '';
      continue;
    }
    current += char;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0]!;
  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    return record;
  });
}

function readCsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  return parseCsv(readFileSync(path, 'utf8'));
}

function score(row: Record<string, string>): number {
  return Number(row.qualifying_ad_count || 0) * 10 + (row.landing_url ? 3 : 0) + (row.ad_copy?.length ?? 0) / 1_000;
}

function fromMetaAdvertisers(runDir: string, runName: string): OutreachRow[] {
  return readCsv(join(runDir, 'advertisers.csv')).map((row) => ({
    platform: 'meta',
    company_name: row.advertiser_name ?? '',
    company_url: row.advertiser_url ?? '',
    landing_url: row.representative_landing_url ?? '',
    landing_domain: row.landing_domain ?? '',
    person_name: row.person_name ?? '',
    ad_library_url: row.representative_ad_id
      ? `https://www.facebook.com/ads/library/?id=${row.representative_ad_id}`
      : '',
    ad_id: row.representative_ad_id ?? '',
    ad_headline: row.representative_headline ?? '',
    ad_copy: row.representative_copy ?? '',
    ad_active_from: row.active_from ?? '',
    phrases_found: (row.phrases ?? '').replace(/\|/g, ' | '),
    qualifying_ad_count: row.qualifying_ad_count ?? '1',
    source_runs: runName,
  }));
}

function fromLinkedInOutreach(path: string): OutreachRow[] {
  return readCsv(path).map((row) => ({
    platform: 'linkedin',
    company_name: row.company_name ?? '',
    company_url: row.linkedin_company_url ?? '',
    landing_url: row.landing_url ?? '',
    landing_domain: row.landing_domain ?? '',
    person_name: row.person_name ?? '',
    ad_library_url: row.ad_library_url ?? '',
    ad_id: row.ad_id ?? '',
    ad_headline: row.ad_headline ?? '',
    ad_copy: row.ad_copy ?? '',
    ad_active_from: row.ad_active_from ?? '',
    phrases_found: row.phrases_found ?? '',
    qualifying_ad_count: row.qualifying_ad_count ?? '1',
    source_runs: row.source_runs ?? 'linkedin',
  }));
}

function mergeRows(rows: OutreachRow[]): OutreachRow[] {
  const byKey = new Map<string, OutreachRow>();
  for (const row of rows) {
    const key = `${row.platform}|${(row.company_name || row.ad_id).toLowerCase()}|${row.landing_domain || row.ad_id}`;
    const existing = byKey.get(key);
    if (!existing || score(row) > score(existing)) {
      const phrases = new Set(
        [...(existing?.phrases_found ?? '').split('|'), ...row.phrases_found.split('|')]
          .flatMap((part) => part.split('|'))
          .map((part) => part.trim())
          .filter(Boolean),
      );
      const runs = new Set(
        [...(existing?.source_runs ?? '').split('|'), ...row.source_runs.split('|')]
          .flatMap((part) => part.split('|'))
          .map((part) => part.trim())
          .filter(Boolean),
      );
      byKey.set(key, {
        ...row,
        phrases_found: [...phrases].join(' | ') || row.phrases_found,
        source_runs: [...runs].join(' | ') || row.source_runs,
        qualifying_ad_count: String(
          Math.max(Number(existing?.qualifying_ad_count || 0), Number(row.qualifying_ad_count || 0)),
        ),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const count = Number(b.qualifying_ad_count) - Number(a.qualifying_ad_count);
    if (count !== 0) return count;
    return a.company_name.localeCompare(b.company_name);
  });
}

function main(): void {
  const root = process.env.INIT_CWD ?? process.cwd();
  const args = process.argv.slice(2);
  const metaRuns: string[] = [];
  let linkedInPath =
    'scripts/lead-sourcing/linkedin-webinar-ads/output/exports/linkedin-webinar-outreach.csv';
  let outDir = 'scripts/lead-sourcing/meta-webinar-ads/output/exports';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--meta-run' && args[i + 1]) metaRuns.push(args[++i]!);
    else if (args[i] === '--linkedin-csv' && args[i + 1]) linkedInPath = args[++i]!;
    else if (args[i] === '--out-dir' && args[i + 1]) outDir = args[++i]!;
  }
  if (metaRuns.length === 0) throw new Error('Provide at least one --meta-run <run-dir>');

  const exportDir = ensureRunDir(resolve(root, outDir));
  const metaRows = metaRuns.flatMap((run) => {
    const runDir = resolve(root, run);
    return fromMetaAdvertisers(runDir, run.split('/').pop() ?? run);
  });
  const linkedInRows = fromLinkedInOutreach(resolve(root, linkedInPath));
  const metaMerged = mergeRows(metaRows);
  const combined = mergeRows([...linkedInRows, ...metaMerged]);

  writeCsv(join(exportDir, 'meta-webinar-outreach.csv'), metaMerged, [...OUTREACH_COLUMNS]);
  writeCsv(join(exportDir, 'webinar-outreach.csv'), combined, [...OUTREACH_COLUMNS]);
  console.log(JSON.stringify({
    meta_companies: metaMerged.length,
    linkedin_companies: linkedInRows.length,
    combined_companies: combined.length,
    meta_csv: join(exportDir, 'meta-webinar-outreach.csv'),
    combined_csv: join(exportDir, 'webinar-outreach.csv'),
  }));
}

main();
