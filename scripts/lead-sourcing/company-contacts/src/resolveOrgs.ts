import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { parseCliArgs, truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv, useFixtures } from '../../webinar-hosts/src/lib/env.js';
import { sleepWithJitter } from '../../webinar-hosts/src/lib/retry.js';
import {
  enrichOrganization,
  mapOrganization,
  type ApolloClientOptions,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import {
  createResolveCheckpoint,
  loadResolveCheckpoint,
  saveResolveCheckpoint,
} from './checkpoint.js';
import type { CompanyRow, ResolvedCompanyRow } from './types.js';

export type ResolveOrgsOptions = {
  runDir: string;
  companiesPath?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  maxApolloCalls?: number | null;
  useFixtures?: boolean;
  counter?: CallCounter;
};

export async function resolveOrgs(options: ResolveOrgsOptions): Promise<{
  runDir: string;
  resolved: ResolvedCompanyRow[];
  resolvedPath: string;
}> {
  const runDir = resolve(options.runDir);
  const companiesPath = resolve(options.companiesPath ?? join(runDir, 'companies.csv'));
  if (!existsSync(companiesPath)) {
    throw new Error(`companies.csv not found at ${companiesPath}`);
  }

  let companies = readCsv(companiesPath) as CompanyRow[];
  companies = truncateRows(companies, options.maxRows ?? null);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          companies: companies.length,
          estimated_apollo_org_calls: companies.length,
        },
        null,
        2,
      ),
    );
    return { runDir, resolved: [], resolvedPath: join(runDir, 'companies_resolved.csv') };
  }

  const fixtures = options.useFixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const apolloOptions: ApolloClientOptions = { useFixtures: fixtures, counter };

  let checkpoint = loadResolveCheckpoint(runDir);
  if (checkpoint && checkpoint.companies_path !== companiesPath) {
    throw new Error(
      `Checkpoint companies_path mismatch: ${checkpoint.companies_path} vs ${companiesPath}`,
    );
  }
  if (!checkpoint) {
    checkpoint = createResolveCheckpoint(companiesPath, companies.length);
  }

  for (let i = checkpoint.next_index; i < companies.length; i++) {
    if (
      options.maxApolloCalls != null &&
      counter.counts.apollo_org_calls >= options.maxApolloCalls
    ) {
      console.error(`[resolve-orgs] hit max apollo calls at ${i}/${companies.length}`);
      break;
    }

    const company = companies[i]!;
    let resolved: ResolvedCompanyRow;
    try {
      const org = await enrichOrganization(
        { domain: company.company_domain, name: company.company_name },
        apolloOptions,
      );
      const mapped = mapOrganization(org);
      resolved = {
        ...company,
        apollo_org_id: mapped.apollo_org_id,
        employee_count: mapped.employee_count,
        industry: mapped.industry,
        company_linkedin_url: mapped.company_linkedin_url,
        enrichment_status: mapped.apollo_org_id ? 'ok' : 'not_found',
        enrichment_error: '',
      };
      if (mapped.company_name) {
        resolved.company_name = mapped.company_name;
      }
      if (mapped.company_domain) {
        resolved.company_domain = mapped.company_domain;
      }
    } catch (error) {
      resolved = {
        ...company,
        apollo_org_id: '',
        employee_count: '',
        industry: '',
        company_linkedin_url: '',
        enrichment_status: 'error',
        enrichment_error: error instanceof Error ? error.message : String(error),
      };
    }

    checkpoint.results.push(resolved);
    checkpoint.next_index = i + 1;
    checkpoint.api_calls = { ...counter.counts };
    saveResolveCheckpoint(runDir, checkpoint);

    if (!fixtures) await sleepWithJitter(200, 100);

    if ((i + 1) % 25 === 0 || i + 1 === companies.length) {
      console.error(
        `[resolve-orgs] ${i + 1}/${companies.length} | ok ${checkpoint.results.filter((r) => r.enrichment_status === 'ok').length} | apollo_org ${counter.counts.apollo_org_calls}`,
      );
    }
  }

  checkpoint.status = checkpoint.next_index >= companies.length ? 'completed' : 'in_progress';
  checkpoint.api_calls = { ...counter.counts };
  saveResolveCheckpoint(runDir, checkpoint);

  return {
    runDir,
    resolved: checkpoint.results,
    resolvedPath: join(runDir, 'companies_resolved.csv'),
  };
}

export async function runResolveOrgsCli(): Promise<void> {
  const cli = parseCliArgs();
  if (cli.fixtures) process.env.USE_FIXTURES = '1';

  await ensureEnv();
  const fixtures = cli.fixtures || useFixtures();
  if (!fixtures && !process.env.APOLLO_API_KEY?.trim()) {
    throw new Error(
      'APOLLO_API_KEY could not be resolved from env or SSM. Set APOLLO_API_KEY or ensure DEV_SECRET_SSM_PREFIX is available.',
    );
  }

  const runDir = cli.runDir ?? cli.resume;
  if (!runDir) {
    console.error('Usage: npm run resolve-orgs -- --run-dir output/runs/...');
    process.exit(1);
  }

  const result = await resolveOrgs({
    runDir,
    dryRun: cli.dryRun,
    maxRows: cli.maxRows,
    maxApolloCalls: cli.maxApolloCalls,
    useFixtures: fixtures,
  });

  const ok = result.resolved.filter((r) => r.enrichment_status === 'ok').length;
  console.log(
    JSON.stringify(
      {
        run_dir: result.runDir,
        resolved_path: result.resolvedPath,
        total: result.resolved.length,
        ok,
        not_found: result.resolved.filter((r) => r.enrichment_status === 'not_found').length,
        error: result.resolved.filter((r) => r.enrichment_status === 'error').length,
      },
      null,
      2,
    ),
  );
}
