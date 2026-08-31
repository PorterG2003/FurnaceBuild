import { existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, truncateRows, requireLiveForPaid } from './lib/cli.js';
import { loadEnv, ensureEnv, packageRoot } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir, loadJson, writeJson } from './lib/io.js';
import { sleep } from './lib/retry.js';
import { enrichOrganizationRaw, fundingFieldsFromOrg } from './lib/apolloClient.js';
import {
  DOMAIN_COLUMNS,
  normalizeLinkedInCompanyUrl,
} from './lib/types.js';

type Checkpoint = {
  next_index: number;
  results: Record<string, string>[];
  apollo_org_calls: number;
};

function hasLinkedInOrDomain(row: Record<string, string>): boolean {
  return Boolean(row.company_linkedin?.trim() || row.company_domain?.trim());
}

export async function enrichFunding(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  fixtures?: boolean;
  maxRows?: number | null;
}): Promise<{ path: string }> {
  const runDir = ensureDir(options.runDir);

  const inputPath = existsSync(join(runDir, 'companies_soc2.csv'))
    ? join(runDir, 'companies_soc2.csv')
    : existsSync(join(runDir, 'companies_classified.csv'))
      ? join(runDir, 'companies_classified.csv')
      : join(runDir, 'companies_with_domains.csv');
  if (!existsSync(inputPath)) {
    throw new Error(`Missing company data in ${runDir}. Run resolve first.`);
  }

  let rows = readCsv(inputPath);
  rows = truncateRows(rows, options.maxRows ?? null);
  const outPath = join(runDir, 'companies_funding.csv');
  const checkpointPath = join(runDir, 'funding_checkpoint.json');

  const enrichable = rows.filter((r) => hasLinkedInOrDomain(r));

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      companies: rows.length,
      enrichable_companies: enrichable.length,
      estimated_apollo_org_calls: enrichable.length,
      note: 'One Apollo org enrich per company with a LinkedIn URL or domain. Companies without either are skipped.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'funding_dry_run.json'), estimate);
    return { path: outPath };
  }

  requireLiveForPaid({
    live: Boolean(options.live),
    dryRun: false,
    fixtures: Boolean(options.fixtures),
    vendor: 'Apollo',
  });

  if (!options.fixtures) {
    await ensureEnv({ apollo: true });
    if (!process.env.APOLLO_API_KEY?.trim()) throw new Error('APOLLO_API_KEY not available');
  }

  const rawPath = join(runDir, 'apollo_org_raw.jsonl');

  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    apollo_org_calls: 0,
  };

  const apolloOpts = {
    useFixtures: Boolean(options.fixtures),
    onCall: () => {
      checkpoint.apollo_org_calls += 1;
    },
  };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const name = (row.company_name ?? '').trim();
    const linkedin = normalizeLinkedInCompanyUrl(row.company_linkedin ?? '');
    const domain = (row.company_domain ?? '').trim();
    console.error(`[funding ${i + 1}/${rows.length}] ${name || row.company_key}`);

    let funding = fundingFieldsFromOrg(null);

    if (linkedin || domain) {
      try {
        const params: { domain?: string; name?: string; linkedinUrl?: string } = {};
        if (linkedin) params.linkedinUrl = linkedin;
        if (domain) params.domain = domain;
        if (name) params.name = name;
        const { organization, raw } = await enrichOrganizationRaw(params, apolloOpts);
        funding = fundingFieldsFromOrg(organization);
        if (raw) {
          appendFileSync(
            rawPath,
            JSON.stringify({ company_key: row.company_key, organization: raw }) + '\n',
            'utf8',
          );
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[funding ${i + 1}/${rows.length}] Apollo error: ${message}`);
      }
    }

    checkpoint.results.push(
      rowToRecord({
        ...row,
        ...funding,
      }),
    );
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, DOMAIN_COLUMNS);
    if (!options.fixtures) await sleep(150);
  }

  const withFunding = checkpoint.results.filter((r) => r.total_funding).length;
  writeJson(join(runDir, 'funding_tally.json'), {
    apollo_org_calls: checkpoint.apollo_org_calls,
    companies: checkpoint.results.length,
    with_funding: withFunding,
  });
  console.log(
    JSON.stringify(
      {
        done: true,
        apollo_org_calls: checkpoint.apollo_org_calls,
        with_funding: withFunding,
      },
      null,
      2,
    ),
  );
  return { path: outPath };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  if (!cli.runDir && !cli.dryRun) throw new Error('--run-dir is required for funding');
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  await enrichFunding({
    runDir,
    dryRun: cli.dryRun,
    live: cli.live,
    fixtures: cli.fixtures,
    maxRows: cli.maxRows,
  });
}

if (process.argv[1]?.includes('enrich-funding.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
