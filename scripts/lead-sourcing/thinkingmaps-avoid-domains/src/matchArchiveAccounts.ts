import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { packageRoot, repoRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|school|schools)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1]?.replace(/\.+$/, '') ?? '';
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

type Match = {
  emails: Set<string>;
  domains: Set<string>;
  files: Set<string>;
  matchedNames: Set<string>;
};

function emptyMatch(): Match {
  return {
    emails: new Set(),
    domains: new Set(),
    files: new Set(),
    matchedNames: new Set(),
  };
}

export function matchArchiveAccounts(runDir: string): {
  accounts: number;
  matched: number;
  domains: number;
} {
  const accounts = readCsv(join(runDir, 'accounts.csv')).filter((row) => row.skipped !== 'true');
  const byName = new Map<string, Record<string, string>[]>();
  for (const account of accounts) {
    const key = normalizeName(account.account_name);
    if (!key) continue;
    const rows = byName.get(key) ?? [];
    rows.push(account);
    byName.set(key, rows);
  }

  const matches = new Map<string, Match>();
  const archiveRoot = join(repoRoot, 'scripts/smartlead-archive/output');
  const paths = collectLeadExportPaths(archiveRoot);
  for (const path of paths) {
    for (const lead of readCsv(path)) {
      const key = normalizeName(lead.company_name ?? '');
      const hitAccounts = byName.get(key);
      if (!hitAccounts?.length) continue;
      const email = (lead.email ?? '').trim().toLowerCase();
      const domain = emailDomain(email);
      if (!email || !domain) continue;
      for (const account of hitAccounts) {
        const accountId = account.account_id;
        const hit = matches.get(accountId) ?? emptyMatch();
        if (hit.emails.size < 5) hit.emails.add(email);
        hit.domains.add(domain);
        hit.files.add(basename(path));
        hit.matchedNames.add(lead.company_name ?? '');
        matches.set(accountId, hit);
      }
    }
  }

  const rows = accounts.map((account) => {
    const hit = matches.get(account.account_id) ?? emptyMatch();
    return rowToRecord({
      account_name: account.account_name,
      account_id: account.account_id,
      parent_account: account.parent_account,
      city: account.city,
      state: account.state,
      matched: hit.domains.size > 0,
      archive_company_names: [...hit.matchedNames].join('|'),
      observed_email_domains: [...hit.domains].sort().join('|'),
      sample_emails: [...hit.emails].join('|'),
      archive_files: hit.files.size,
    });
  });
  writeCsv(join(runDir, 'archive_account_matches.csv'), rows, [
    'account_name',
    'account_id',
    'parent_account',
    'city',
    'state',
    'matched',
    'archive_company_names',
    'observed_email_domains',
    'sample_emails',
    'archive_files',
  ]);

  const domainSet = new Set(
    rows.flatMap((row) => (row.observed_email_domains ?? '').split('|').filter(Boolean)),
  );
  const summary = {
    accounts: accounts.length,
    matched_accounts: rows.filter((row) => row.matched === 'true').length,
    observed_domains: domainSet.size,
    archive_files_scanned: paths.length,
  };
  writeJson(join(runDir, 'archive_account_matches_summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return {
    accounts: summary.accounts,
    matched: summary.matched_accounts,
    domains: summary.observed_domains,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, 'output/runs/full-1'));
  matchArchiveAccounts(runDir);
}

if (process.argv[1]?.includes('matchArchiveAccounts.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
