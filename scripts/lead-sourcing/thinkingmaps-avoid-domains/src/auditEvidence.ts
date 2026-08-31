import { promises as dns } from 'node:dns';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { packageRoot, repoRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';

type Evidence = {
  samples: Set<string>;
  files: Set<string>;
  officialSamples: Set<string>;
  officialLookupNames: Set<string>;
};

function emptyEvidence(): Evidence {
  return {
    samples: new Set(),
    files: new Set(),
    officialSamples: new Set(),
    officialLookupNames: new Set(),
  };
}

function cleanEmail(raw: string): string {
  return raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9._%+@-]+$/g, '');
}

function emailDomain(raw: string): string {
  return cleanEmail(raw).split('@')[1]?.replace(/\\+$/, '') ?? '';
}

function collectLeadExportPaths(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectLeadExportPaths(path));
    else if (entry.isFile() && entry.name === 'leads-export.csv') out.push(path);
  }
  return out;
}

function collectArchiveEvidence(
  candidates: Set<string>,
  root: string,
  evidence: Map<string, Evidence>,
): { files: number; matchedEmails: number } {
  const files = collectLeadExportPaths(root);
  let matchedEmails = 0;
  for (const path of files) {
    for (const row of readCsv(path)) {
      const status = (row.status ?? '').trim().toUpperCase();
      if (/BOUNC|INVALID|FAILED/.test(status)) continue;
      const email = cleanEmail(row.email ?? '');
      const domain = emailDomain(email);
      if (!candidates.has(domain)) continue;
      const hit = evidence.get(domain) ?? emptyEvidence();
      if (hit.samples.size < 5) hit.samples.add(email);
      hit.files.add(basename(path));
      evidence.set(domain, hit);
      matchedEmails += 1;
    }
  }
  return { files: files.length, matchedEmails };
}

function collectOfficialPageEvidence(
  lookupRows: Record<string, string>[],
  candidates: Set<string>,
  evidence: Map<string, Evidence>,
): void {
  for (const row of lookupRows) {
    for (const raw of (row.extracted_emails ?? '').split('|')) {
      const email = cleanEmail(raw);
      const domain = emailDomain(email);
      if (!email || !candidates.has(domain)) continue;
      const hit = evidence.get(domain) ?? emptyEvidence();
      if (hit.officialSamples.size < 5) hit.officialSamples.add(email);
      hit.officialLookupNames.add(row.name);
      evidence.set(domain, hit);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

async function hasMx(domain: string): Promise<{ hasMx: boolean; mx: string }> {
  try {
    const records = await dns.resolveMx(domain);
    return {
      hasMx: records.length > 0,
      mx: records
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 3)
        .map((record) => record.exchange)
        .join('|'),
    };
  } catch {
    return { hasMx: false, mx: '' };
  }
}

export async function auditEvidence(runDir: string): Promise<{
  total: number;
  observedEmail: number;
  mxOnly: number;
  noMx: number;
}> {
  const unique = readCsv(join(runDir, 'unique_domains.csv'));
  const lookups = readCsv(join(runDir, 'lookup_results.csv'));
  const candidates = new Set(unique.map((row) => row.domain.trim().toLowerCase()).filter(Boolean));
  const evidence = new Map<string, Evidence>();

  collectOfficialPageEvidence(lookups, candidates, evidence);
  const archiveRoot = join(repoRoot, 'scripts/smartlead-archive/output');
  const archive = collectArchiveEvidence(candidates, archiveRoot, evidence);

  const domains = [...candidates].sort();
  const mxResults = await mapWithConcurrency(domains, 12, hasMx);
  const rows = domains.map((domain, index) => {
    const source = unique.find((row) => row.domain.trim().toLowerCase() === domain);
    const hit = evidence.get(domain) ?? emptyEvidence();
    const official = hit.officialSamples.size > 0;
    const archiveSeen = hit.samples.size > 0;
    const observed = official || archiveSeen;
    const mx = mxResults[index]!;
    return rowToRecord({
      domain,
      source_accounts: source?.source_accounts ?? '',
      scope: source?.scope ?? '',
      observed_email: observed,
      evidence_kind: official
        ? archiveSeen
          ? 'official_page+smartlead_archive'
          : 'official_page'
        : archiveSeen
          ? 'smartlead_archive'
          : mx.hasMx
            ? 'mx_only'
            : 'none',
      official_sample_emails: [...hit.officialSamples].join('|'),
      official_lookup_names: [...hit.officialLookupNames].join('|'),
      archive_sample_emails: [...hit.samples].join('|'),
      archive_files: hit.files.size,
      has_mx: mx.hasMx,
      mx_hosts: mx.mx,
    });
  });

  writeCsv(join(runDir, 'domain_evidence.csv'), rows, [
    'domain',
    'source_accounts',
    'scope',
    'observed_email',
    'evidence_kind',
    'official_sample_emails',
    'official_lookup_names',
    'archive_sample_emails',
    'archive_files',
    'has_mx',
    'mx_hosts',
  ]);

  const summary = {
    total: rows.length,
    observed_email: rows.filter((row) => row.observed_email === 'true').length,
    mx_only: rows.filter((row) => row.evidence_kind === 'mx_only').length,
    no_mx: rows.filter((row) => row.has_mx !== 'true').length,
    archive_files_scanned: archive.files,
    archive_email_matches: archive.matchedEmails,
  };
  writeJson(join(runDir, 'domain_evidence_summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return {
    total: summary.total,
    observedEmail: summary.observed_email,
    mxOnly: summary.mx_only,
    noMx: summary.no_mx,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, 'output/runs/full-1'));
  await auditEvidence(runDir);
}

if (process.argv[1]?.includes('auditEvidence.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
