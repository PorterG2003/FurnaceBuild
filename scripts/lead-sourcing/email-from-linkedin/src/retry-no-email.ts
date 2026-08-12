import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { createRunDir, parseCliArgs, truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv, useFixtures } from '../../webinar-hosts/src/lib/env.js';
import type { ApolloClientOptions } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import {
  createCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  writeOutputs,
} from './checkpoint.js';
import type { MillionVerifierOptions } from './millionVerifier.js';
import { createSchoolDomainResolver } from './resolveSchoolDomain.js';
import { createTempWebhookInbox } from './tempWebhook.js';
import { retryNoEmailRow } from './retryNoEmail.js';
import type { EnrichedUniqueRow, EnrichMatchMethod, EnrichmentStatus } from './types.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveAmplifySecretParamPathForTarget,
  resolveMillionVerifierApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../self-recovery-env.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RETRY_LOG_FILE = 'retry_log.jsonl';

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function resolveRunDir(path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(packageRoot, path);
}

function toEnrichedRow(raw: Record<string, string>): EnrichedUniqueRow {
  return {
    linkedin_url: raw.linkedin_url ?? '',
    reactor_name: raw.reactor_name ?? '',
    reactor_headline: raw.reactor_headline ?? '',
    k12_role: raw.k12_role ?? '',
    source: raw.source ?? '',
    email: raw.email ?? '',
    first_name: raw.first_name ?? '',
    last_name: raw.last_name ?? '',
    title: raw.title ?? '',
    company_name: raw.company_name ?? '',
    company_domain: raw.company_domain ?? '',
    apollo_person_id: raw.apollo_person_id ?? '',
    enrichment_status: (raw.enrichment_status as EnrichmentStatus) || 'not_found',
    match_method: (raw.match_method as EnrichMatchMethod) || 'none',
    error: raw.error ?? '',
    retry_pass: raw.retry_pass || 'unchanged',
  };
}

async function ensureMillionVerifierKey(): Promise<void> {
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) return;
  loadSelfRecoveryEnv();
  const explicitTarget = process.env.APOLLO_SECRET_TARGET_ENV?.trim().toLowerCase();
  const targets: Array<'prod' | 'dev'> =
    explicitTarget === 'prod' || explicitTarget === 'dev'
      ? [explicitTarget]
      : ['dev', resolveSelfRecoveryTargetEnv()];

  for (const targetEnv of [...new Set(targets)]) {
    try {
      const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
      process.env.MILLION_VERIFIER_API_KEY = apiKey;
      return;
    } catch {
      // try next
    }
  }
}

async function ensureOpenRouterKey(): Promise<void> {
  if (process.env.OPENROUTER_API_KEY?.trim()) return;
  loadSelfRecoveryEnv();
  const explicitTarget = process.env.APOLLO_SECRET_TARGET_ENV?.trim().toLowerCase();
  const targets: Array<'prod' | 'dev'> =
    explicitTarget === 'prod' || explicitTarget === 'dev'
      ? [explicitTarget]
      : ['dev', resolveSelfRecoveryTargetEnv()];
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  for (const targetEnv of [...new Set(targets)]) {
    const paramPath = resolveAmplifySecretParamPathForTarget(targetEnv, 'OPENROUTER_API_KEY');
    if (!paramPath) continue;
    try {
      process.env.OPENROUTER_API_KEY = await fetchSecretFromParameterStore(paramPath, awsRegion);
      return;
    } catch {
      // try next
    }
  }
}

function appendRetryLog(runDir: string, entry: Record<string, unknown>): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, RETRY_LOG_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
}

function printProgress(
  processed: number,
  total: number,
  newlyFound: number,
  apolloCalls: number,
): void {
  process.stdout.write(
    `\r  ${processed}/${total} retry | new_email ${newlyFound} | apollo ${apolloCalls}   `,
  );
}

async function main(): Promise<void> {
  const options = parseCliArgs();
  const argv = process.argv.slice(2);
  const useWaterfall = !argv.includes('--no-waterfall');
  const waterfallOnly = argv.includes('--waterfall-only');
  if (options.fixtures) process.env.USE_FIXTURES = '1';

  await ensureEnv();
  const fixtures = useFixtures() || options.fixtures;
  if (!fixtures) {
    await ensureMillionVerifierKey();
    if (!argv.includes('--no-llm')) {
      await ensureOpenRouterKey();
    }
  }

  if (!fixtures && !process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY is required for live retry (or use --fixtures).');
  }

  let runDir: string;
  let inputPath: string;
  let checkpoint = options.resume ? loadCheckpoint(resolveRunDir(options.resume)) : null;

  if (options.resume) {
    runDir = resolveRunDir(options.resume);
    checkpoint = loadCheckpoint(runDir);
    if (!checkpoint) throw new Error(`No checkpoint found in ${runDir}`);
    inputPath = checkpoint.input_path;
  } else {
    if (!options.input) {
      throw new Error(
        'Usage: npm run retry-no-email -- --input <enriched_unique.csv> [--run-dir ...] [--resume ...] [--no-waterfall]',
      );
    }
    inputPath = resolvePath(options.input);
    runDir = options.runDir ? resolveRunDir(options.runDir) : resolve(packageRoot, createRunDir());
  }

  mkdirSync(runDir, { recursive: true });

  const allRows = readCsv(inputPath).map(toEnrichedRow);
  const kept = allRows.filter((row) => row.enrichment_status === 'email_found');
  let toRetry = allRows.filter(
    (row) => row.enrichment_status === 'matched_no_email' || row.enrichment_status === 'not_found',
  );
  toRetry = truncateRows(toRetry, options.maxRows);

  const resultsByUrl = new Map<string, EnrichedUniqueRow>();
  for (const row of kept) {
    resultsByUrl.set(row.linkedin_url, { ...row, retry_pass: row.retry_pass || 'unchanged' });
  }

  if (!checkpoint) {
    checkpoint = createCheckpoint(inputPath, toRetry.length);
    // Seed results with already-found emails so outputs stay complete mid-run
    checkpoint.results = [...kept];
  } else {
    for (const row of checkpoint.results) {
      resultsByUrl.set(row.linkedin_url, row);
    }
  }

  const counter = new CallCounter();
  counter.merge(checkpoint.api_calls);

  const apolloOptions: ApolloClientOptions = {
    useFixtures: fixtures,
    counter,
  };
  const mvOptions: MillionVerifierOptions = {
    useFixtures: fixtures,
  };
  const resolveDomain = createSchoolDomainResolver(apolloOptions);

  const useLlm = !argv.includes('--no-llm');
  const llmOptions =
    useLlm
      ? {
          useFixtures: fixtures,
          counter,
          enabled: fixtures || Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        }
      : undefined;

  let waterfallInbox = undefined;
  if (useWaterfall && !fixtures) {
    waterfallInbox = await createTempWebhookInbox();
  } else if (useWaterfall && fixtures) {
    waterfallInbox = { token: 'fixture', url: 'https://webhook.site/fixture' };
  }

  console.log('Retry no-email (domain → rematch → waterfall → pattern+MV)');
  console.log(`  input: ${inputPath}`);
  console.log(`  run_dir: ${runDir}`);
  console.log(`  already_have_email: ${kept.length}`);
  console.log(`  to_retry: ${toRetry.length}`);
  console.log(`  fixtures: ${fixtures ? 'yes' : 'no'}`);
  console.log(`  apollo_waterfall: ${waterfallInbox ? 'yes' : 'no'}`);
  console.log(
    `  llm_headline_org: ${llmOptions?.enabled ? 'yes' : useLlm ? 'no (missing OPENROUTER_API_KEY)' : 'disabled'}`,
  );
  if (waterfallOnly) console.log(`  waterfall_only: yes`);
  if (waterfallInbox && !fixtures) console.log(`  webhook: ${waterfallInbox.url}`);
  if (options.maxApolloCalls != null) console.log(`  max_apollo_calls: ${options.maxApolloCalls}`);
  if (checkpoint.next_index > 0) console.log(`  resume_from: ${checkpoint.next_index}`);

  let newlyFound = [...resultsByUrl.values()].filter(
    (row) =>
      row.enrichment_status === 'email_found' &&
      row.retry_pass &&
      row.retry_pass !== 'unchanged',
  ).length;
  // On fresh run, newlyFound starts at 0
  if (!options.resume) newlyFound = 0;

  const passCounts = {
    pass1_waterfall: 0,
    pass2_domain: 0,
    pass3_pattern_mv: 0,
    unchanged: 0,
    error: 0,
  };

  for (let i = checkpoint.next_index; i < toRetry.length; i++) {
    if (options.maxApolloCalls != null && counter.counts.apollo_people_calls >= options.maxApolloCalls) {
      console.log(`\n  Stopping: max Apollo calls reached (${options.maxApolloCalls})`);
      break;
    }

    const inputRow = toRetry[i]!;
    if (
      resultsByUrl.get(inputRow.linkedin_url)?.enrichment_status === 'email_found' &&
      resultsByUrl.get(inputRow.linkedin_url)?.retry_pass &&
      resultsByUrl.get(inputRow.linkedin_url)?.retry_pass !== 'unchanged'
    ) {
      checkpoint.next_index = i + 1;
      continue;
    }

    const { row, pass } = await retryNoEmailRow(inputRow, {
      apolloOptions,
      mvOptions,
      resolveDomain,
      waterfallInbox,
      waterfallOnly,
      llmOptions,
    });

    resultsByUrl.set(row.linkedin_url, row);
    if (pass === 'pass1_waterfall' || pass === 'pass2_domain' || pass === 'pass3_pattern_mv') {
      if (row.enrichment_status === 'email_found') {
        passCounts[pass] += 1;
        newlyFound += 1;
      } else if (row.enrichment_status === 'error') {
        passCounts.error += 1;
      } else {
        passCounts.unchanged += 1;
      }
    } else if (row.enrichment_status === 'error') {
      passCounts.error += 1;
    } else {
      passCounts.unchanged += 1;
    }

    const merged = [
      ...kept.map((r) => resultsByUrl.get(r.linkedin_url) ?? r),
      ...toRetry.map((r) => resultsByUrl.get(r.linkedin_url) ?? r),
    ];
    // Dedup by linkedin_url preserving order: kept first then retries
    const seen = new Set<string>();
    const uniqueMerged: EnrichedUniqueRow[] = [];
    for (const r of [...kept, ...toRetry]) {
      const latest = resultsByUrl.get(r.linkedin_url) ?? r;
      if (seen.has(latest.linkedin_url)) continue;
      seen.add(latest.linkedin_url);
      uniqueMerged.push(latest);
    }

    checkpoint.next_index = i + 1;
    checkpoint.results = uniqueMerged;
    checkpoint.api_calls = counter.snapshot();
    checkpoint.stats = {
      unique_profiles: uniqueMerged.length,
      processed: i + 1,
      email_found: uniqueMerged.filter((r) => r.enrichment_status === 'email_found').length,
      matched_no_email: uniqueMerged.filter((r) => r.enrichment_status === 'matched_no_email').length,
      not_found: uniqueMerged.filter((r) => r.enrichment_status === 'not_found').length,
      error: uniqueMerged.filter((r) => r.enrichment_status === 'error').length,
    };
    saveCheckpoint(runDir, checkpoint);
    writeOutputs(runDir, uniqueMerged);
    appendRetryLog(runDir, {
      linkedin_url: row.linkedin_url,
      reactor_name: row.reactor_name,
      pass,
      enrichment_status: row.enrichment_status,
      match_method: row.match_method,
      email: row.email,
      company_domain: row.company_domain,
      error: row.error || undefined,
      api_calls: counter.snapshot(),
    });

    printProgress(i + 1, toRetry.length, newlyFound, counter.counts.apollo_people_calls);
    void merged;
  }

  const finalSeen = new Set<string>();
  const finalRows: EnrichedUniqueRow[] = [];
  for (const r of [...kept, ...toRetry]) {
    const latest = resultsByUrl.get(r.linkedin_url) ?? r;
    if (finalSeen.has(latest.linkedin_url)) continue;
    finalSeen.add(latest.linkedin_url);
    finalRows.push(latest);
  }

  writeOutputs(runDir, finalRows);
  const completedAll = checkpoint.next_index >= toRetry.length;
  checkpoint.status = completedAll ? 'completed' : 'in_progress';
  checkpoint.results = finalRows;
  checkpoint.api_calls = counter.snapshot();
  checkpoint.stats = {
    unique_profiles: finalRows.length,
    processed: Math.min(checkpoint.next_index, toRetry.length),
    email_found: finalRows.filter((r) => r.enrichment_status === 'email_found').length,
    matched_no_email: finalRows.filter((r) => r.enrichment_status === 'matched_no_email').length,
    not_found: finalRows.filter((r) => r.enrichment_status === 'not_found').length,
    error: finalRows.filter((r) => r.enrichment_status === 'error').length,
  };
  saveCheckpoint(runDir, checkpoint);

  console.log(`\nDone.`);
  console.log(`  total_with_email: ${checkpoint.stats.email_found} (started with ${kept.length})`);
  console.log(`  newly_found: ${newlyFound}`);
  console.log(`  pass2_domain hits: ${passCounts.pass2_domain}`);
  console.log(`  pass1_waterfall hits: ${passCounts.pass1_waterfall}`);
  console.log(`  pass3_pattern_mv hits: ${passCounts.pass3_pattern_mv}`);
  console.log(`  still_no_email: ${checkpoint.stats.matched_no_email}`);
  console.log(`  apollo_people_calls: ${counter.counts.apollo_people_calls}`);
  console.log(`  apollo_org_calls: ${counter.counts.apollo_org_calls}`);
  console.log(`  serper_searches: ${counter.counts.serper_searches}`);
  console.log(`  openrouter_calls: ${counter.counts.openrouter_calls}`);
  console.log(`  outputs:`);
  console.log(`    ${join(runDir, 'enriched_unique.csv')}`);
  console.log(`    ${join(runDir, 'with_email.csv')}`);
  console.log(`    ${join(runDir, RETRY_LOG_FILE)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
