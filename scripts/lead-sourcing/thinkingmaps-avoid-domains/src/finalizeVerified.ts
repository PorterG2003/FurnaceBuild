import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { packageRoot, repoRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';
import {
  MANUAL_VERIFICATIONS,
  type DomainVerification,
  type ManualVerification,
} from './verifiedDomains.js';

type LookupDomain = DomainVerification & {
  evidenceKind:
    | 'manual_official_source'
    | 'official_page'
    | 'smartlead_archive'
    | 'official_page+smartlead_archive';
};

type ResolvedLookup = {
  status: 'verified' | 'partial' | 'ambiguous' | 'unresolved';
  domains: LookupDomain[];
  note: string;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function lookupKeysForAccount(account: Record<string, string>): string[] {
  return [
    account.district_lookup_key,
    account.school_lookup_key,
    account.org_lookup_key,
  ].filter(Boolean);
}

function splitPipes(value: string): string[] {
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function manualLookup(
  manual: ManualVerification,
): ResolvedLookup {
  return {
    status: manual.status,
    domains: manual.domains.map((domain) => ({
      ...domain,
      domain: normalized(domain.domain),
      evidenceKind: 'manual_official_source',
    })),
    note: manual.note ?? '',
  };
}

export function finalizeVerified(runDir: string): {
  domains: number;
  verifiedAccounts: number;
  individualEmailAccounts: number;
  partialAccounts: number;
  unresolvedAccounts: number;
} {
  const accounts = readCsv(join(runDir, 'accounts.csv'));
  const lookups = readCsv(join(runDir, 'lookup_results.csv'));
  const unique = readCsv(join(runDir, 'unique_domains.csv'));
  const evidenceRows = readCsv(join(runDir, 'domain_evidence.csv'));
  const raleighEmailsPath = join(runDir, 'raleigh_staff_emails.csv');
  const raleighEmails = existsSync(raleighEmailsPath) ? readCsv(raleighEmailsPath) : [];

  const manualByName = new Map(
    MANUAL_VERIFICATIONS.map((entry) => [normalized(entry.lookupName), entry]),
  );
  const evidenceByDomain = new Map(
    evidenceRows.map((row) => [normalized(row.domain), row]),
  );
  const uniqueByDomain = new Map(unique.map((row) => [normalized(row.domain), row]));

  const accountNamesByLookup = new Map<string, Set<string>>();
  for (const account of accounts) {
    if (account.skipped === 'true') continue;
    for (const lookupKey of lookupKeysForAccount(account)) {
      const names = accountNamesByLookup.get(lookupKey) ?? new Set<string>();
      names.add(account.account_name);
      accountNamesByLookup.set(lookupKey, names);
    }
  }

  const resolvedLookups = new Map<string, ResolvedLookup>();
  for (const lookup of lookups) {
    const manual = manualByName.get(normalized(lookup.name));
    if (manual) {
      resolvedLookups.set(lookup.lookup_key, manualLookup(manual));
      continue;
    }

    const linkedNames = accountNamesByLookup.get(lookup.lookup_key) ?? new Set<string>();
    const domains: LookupDomain[] = [];
    for (const [domain, uniqueRow] of uniqueByDomain) {
      const evidence = evidenceByDomain.get(domain);
      if (evidence?.observed_email !== 'true') continue;
      const sources = new Set(splitPipes(uniqueRow.source_accounts ?? ''));
      const linked =
        sources.has(lookup.name) ||
        [...linkedNames].some((accountName) => sources.has(accountName));
      if (!linked) continue;
      const sampleEmail =
        splitPipes(evidence.official_sample_emails ?? '')[0] ??
        splitPipes(evidence.archive_sample_emails ?? '')[0] ??
        '';
      domains.push({
        domain,
        sampleEmail,
        evidenceUrl: (evidence.evidence_kind ?? '').includes('official_page')
          ? lookup.website_url ?? ''
          : '',
        evidenceKind: (evidence.evidence_kind || 'smartlead_archive') as LookupDomain['evidenceKind'],
      });
    }

    resolvedLookups.set(lookup.lookup_key, {
      status: domains.length > 0 ? 'verified' : 'unresolved',
      domains,
      note: domains.length > 0 ? 'Observed public or non-bounced archived email' : 'No verified email domain',
    });
  }

  const domainAgg = new Map<
    string,
    {
      accounts: Set<string>;
      lookups: Set<string>;
      samples: Set<string>;
      evidenceUrls: Set<string>;
      evidenceKinds: Set<string>;
      notes: Set<string>;
    }
  >();
  const coverageRows: Record<string, string>[] = [];
  const askRows: Record<string, string>[] = [];

  let verifiedAccounts = 0;
  let individualEmailAccounts = 0;
  let partialAccounts = 0;
  let unresolvedAccounts = 0;
  for (const account of accounts) {
    if (account.skipped === 'true') continue;
    const linked = lookupKeysForAccount(account)
      .map((key) => ({ key, result: resolvedLookups.get(key) }))
      .filter((item): item is { key: string; result: ResolvedLookup } => Boolean(item.result));
    const domains = new Set(linked.flatMap((item) => item.result.domains.map((entry) => entry.domain)));
    const partial = linked.some((item) => item.result.status === 'partial');
    const ambiguous = linked.filter((item) =>
      item.result.status === 'ambiguous' || item.result.status === 'unresolved',
    );
    const individualEmailCount =
      account.account_name === 'Raleigh County Schools' ? raleighEmails.length : 0;
    const status =
      domains.size === 0 && individualEmailCount > 0
        ? 'individual_emails'
        : domains.size === 0
          ? 'unresolved'
          : partial
            ? 'partial'
            : 'verified';

    if (status === 'verified') verifiedAccounts += 1;
    else if (status === 'individual_emails') individualEmailAccounts += 1;
    else if (status === 'partial') partialAccounts += 1;
    else unresolvedAccounts += 1;

    const notes = linked.map((item) => item.result.note).filter(Boolean);
    coverageRows.push(
      rowToRecord({
        account_name: account.account_name,
        account_id: account.account_id,
        parent_account: account.parent_account,
        city: account.city,
        state: account.state,
        email_domains: [...domains].sort().join('|'),
        individual_email_count: individualEmailCount,
        coverage_status: status,
        notes: [...new Set(notes)].join(' | '),
      }),
    );

    if (status === 'partial' || status === 'unresolved') {
      askRows.push(
        rowToRecord({
          account_name: account.account_name,
          parent_account: account.parent_account,
          city: account.city,
          state: account.state,
          verified_partial_domains: [...domains].sort().join('|'),
          reason: status,
          notes: [
            ...new Set([
              ...notes,
              ...ambiguous.map((item) => item.result.note).filter(Boolean),
            ]),
          ].join(' | '),
        }),
      );
    }

    for (const item of linked) {
      const lookupName = lookups.find((lookup) => lookup.lookup_key === item.key)?.name ?? item.key;
      for (const entry of item.result.domains) {
        const agg = domainAgg.get(entry.domain) ?? {
          accounts: new Set<string>(),
          lookups: new Set<string>(),
          samples: new Set<string>(),
          evidenceUrls: new Set<string>(),
          evidenceKinds: new Set<string>(),
          notes: new Set<string>(),
        };
        agg.accounts.add(account.account_name);
        agg.lookups.add(lookupName);
        if (entry.sampleEmail) agg.samples.add(entry.sampleEmail);
        if (entry.evidenceUrl) agg.evidenceUrls.add(entry.evidenceUrl);
        agg.evidenceKinds.add(entry.evidenceKind);
        if (item.result.note) agg.notes.add(item.result.note);
        domainAgg.set(entry.domain, agg);
      }
    }
  }

  const domainRows = [...domainAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, agg]) =>
      rowToRecord({
        domain,
        type: 'domain',
        source_accounts: [...agg.accounts].sort().join('|'),
        resolved_entities: [...agg.lookups].sort().join('|'),
        evidence_kind: [...agg.evidenceKinds].sort().join('|'),
        sample_email: [...agg.samples][0] ?? '',
        evidence_url: [...agg.evidenceUrls][0] ?? '',
        notes: [...agg.notes].join(' | '),
      }),
    );
  const excludedPriorCandidates = [...uniqueByDomain.keys()]
    .filter((domain) => !domainAgg.has(domain))
    .sort();
  const invalidEvidenceRows = domainRows.filter((row) => {
    const emailDomain = normalized(row.sample_email ?? '').split('@')[1] ?? '';
    return !row.sample_email || emailDomain !== row.domain;
  });
  if (invalidEvidenceRows.length > 0) {
    throw new Error(
      `Refusing to write block list: ${invalidEvidenceRows.length} domains lack matching sample-email evidence`,
    );
  }
  const archiveOnlyRows = domainRows.filter(
    (row) => row.evidence_kind === 'smartlead_archive',
  );
  if (archiveOnlyRows.length > 0) {
    throw new Error(
      `Refusing to write strict block list: ${archiveOnlyRows.length} domains have archive-only evidence`,
    );
  }

  const blockRows = domainRows.map((row) => ({ domain: row.domain, type: 'domain' }));
  writeCsv(join(runDir, 'verified_unique_domains.csv'), domainRows, [
    'domain',
    'type',
    'source_accounts',
    'resolved_entities',
    'evidence_kind',
    'sample_email',
    'evidence_url',
    'notes',
  ]);
  writeCsv(join(runDir, 'verified_block_list_domains.csv'), blockRows, ['domain', 'type']);
  writeCsv(join(runDir, 'account_domain_coverage.csv'), coverageRows, [
    'account_name',
    'account_id',
    'parent_account',
    'city',
    'state',
    'email_domains',
    'individual_email_count',
    'coverage_status',
    'notes',
  ]);
  writeCsv(join(runDir, 'ask_verified_remaining.csv'), askRows, [
    'account_name',
    'parent_account',
    'city',
    'state',
    'verified_partial_domains',
    'reason',
    'notes',
  ]);
  writeCsv(
    join(runDir, 'verified_block_list_emails.csv'),
    raleighEmails.map((row) => ({ email: row.email, type: 'email' })),
    ['email', 'type'],
  );
  writeCsv(
    join(runDir, 'verified_block_list.csv'),
    [
      ...blockRows.map((row) => ({ value: row.domain, type: 'domain' })),
      ...raleighEmails.map((row) => ({ value: row.email, type: 'email' })),
    ],
    ['value', 'type'],
  );

  const tmpBlockPath = join(repoRoot, 'tmp/thinkingmaps-avoid-block-domains.csv');
  const tmpEmailPath = join(repoRoot, 'tmp/thinkingmaps-avoid-block-emails.csv');
  const tmpCombinedPath = join(repoRoot, 'tmp/thinkingmaps-avoid-block-list.csv');
  const tmpReviewPath = join(repoRoot, 'tmp/thinkingmaps-avoid-unique-domains.csv');
  copyFileSync(join(runDir, 'verified_block_list_domains.csv'), tmpBlockPath);
  copyFileSync(join(runDir, 'verified_block_list_emails.csv'), tmpEmailPath);
  copyFileSync(join(runDir, 'verified_block_list.csv'), tmpCombinedPath);
  copyFileSync(join(runDir, 'verified_unique_domains.csv'), tmpReviewPath);

  const summary = {
    source_accounts: accounts.filter((account) => account.skipped !== 'true').length,
    verified_accounts: verifiedAccounts,
    individual_email_accounts: individualEmailAccounts,
    partial_accounts: partialAccounts,
    unresolved_accounts: unresolvedAccounts,
    verified_email_domains: domainRows.length,
    official_source_domains: domainRows.length,
    verified_individual_emails: raleighEmails.length,
    excluded_prior_candidates: excludedPriorCandidates.length,
    excluded_prior_candidate_domains: excludedPriorCandidates,
    remaining_review: askRows.map((row) => row.account_name),
    combined_block_list_path: tmpCombinedPath,
    domain_block_list_path: tmpBlockPath,
    individual_email_block_list_path: tmpEmailPath,
    review_path: tmpReviewPath,
  };
  writeJson(join(runDir, 'verified_summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return {
    domains: domainRows.length,
    verifiedAccounts,
    individualEmailAccounts,
    partialAccounts,
    unresolvedAccounts,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, 'output/runs/full-1'));
  finalizeVerified(runDir);
}

if (process.argv[1]?.includes('finalizeVerified.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
