import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { createRunDir, parseCliArgs, truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv, useFixtures } from '../../webinar-hosts/src/lib/env.js';
import { normalizeLinkedInProfileUrl } from '../../webinar-hosts/src/stage2-linkedin/linkedinParser.js';
import type { ApolloClientOptions } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import {
  appendEnrichmentLog,
  bumpStat,
  createCheckpoint,
  ENRICHED_FULL_CSV,
  loadCheckpoint,
  saveCheckpoint,
  writeOutputs,
} from './checkpoint.js';
import { enrichReactorProfile } from './enrichPerson.js';
import { FULL_JOIN_EXTRA_COLUMNS, type EnrichedUniqueRow, type ScrapeRow } from './types.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function resolveRunDir(path: string): string {
  const abs = resolvePath(path);
  // Allow relative run dirs from package root when cwd is elsewhere
  if (!isAbsolute(path) && !path.startsWith('output/')) {
    return abs;
  }
  if (!isAbsolute(path)) {
    return resolve(packageRoot, path);
  }
  return abs;
}

function toScrapeRow(raw: Record<string, string>): ScrapeRow {
  return {
    source: raw.source ?? '',
    post_url: raw.post_url ?? '',
    reactor_name: raw.reactor_name ?? '',
    reactor_profile_url: raw.reactor_profile_url ?? '',
    reactor_headline: raw.reactor_headline ?? '',
    k12_role: raw.k12_role ?? '',
    reaction_type: raw.reaction_type ?? '',
  };
}

type UniqueProfile = {
  linkedinUrl: string;
  sample: ScrapeRow;
};

function dedupeProfiles(rows: ScrapeRow[]): UniqueProfile[] {
  const byUrl = new Map<string, UniqueProfile>();
  for (const row of rows) {
    const linkedinUrl = normalizeLinkedInProfileUrl(row.reactor_profile_url);
    if (!linkedinUrl) continue;
    if (!byUrl.has(linkedinUrl)) {
      byUrl.set(linkedinUrl, { linkedinUrl, sample: row });
    }
  }
  return [...byUrl.values()];
}

function writeFullJoin(
  runDir: string,
  scrapeRows: ScrapeRow[],
  uniqueRows: EnrichedUniqueRow[],
): void {
  const byUrl = new Map(uniqueRows.map((row) => [row.linkedin_url, row]));
  const columns = [
    'source',
    'post_url',
    'reactor_name',
    'reactor_profile_url',
    'reactor_headline',
    'k12_role',
    'reaction_type',
    ...FULL_JOIN_EXTRA_COLUMNS,
  ];
  const joined = scrapeRows.map((row) => {
    const url = normalizeLinkedInProfileUrl(row.reactor_profile_url);
    const enriched = byUrl.get(url);
    return {
      ...row,
      email: enriched?.email ?? '',
      first_name: enriched?.first_name ?? '',
      last_name: enriched?.last_name ?? '',
      title: enriched?.title ?? '',
      company_name: enriched?.company_name ?? '',
      company_domain: enriched?.company_domain ?? '',
      apollo_person_id: enriched?.apollo_person_id ?? '',
      enrichment_status: enriched?.enrichment_status ?? '',
      match_method: enriched?.match_method ?? '',
    };
  });
  writeCsv(join(runDir, ENRICHED_FULL_CSV), joined, columns);
}

function printProgress(processed: number, total: number, stats: { email_found: number }, apolloCalls: number): void {
  process.stdout.write(
    `\r  ${processed}/${total} unique | email ${stats.email_found} | apollo ${apolloCalls}   `,
  );
}

async function main(): Promise<void> {
  const options = parseCliArgs();
  if (options.fixtures) {
    process.env.USE_FIXTURES = '1';
  }

  await ensureEnv();

  const fixtures = useFixtures() || options.fixtures;
  if (!fixtures && !process.env.APOLLO_API_KEY?.trim()) {
    throw new Error(
      'APOLLO_API_KEY is required for live enrichment. Set it in .env or use --fixtures / USE_FIXTURES=1.',
    );
  }

  let runDir: string;
  let inputPath: string;
  let checkpoint = options.resume ? loadCheckpoint(resolveRunDir(options.resume)) : null;

  if (options.resume) {
    runDir = resolveRunDir(options.resume);
    checkpoint = loadCheckpoint(runDir);
    if (!checkpoint) {
      throw new Error(`No checkpoint found in ${runDir}`);
    }
    inputPath = checkpoint.input_path;
  } else {
    if (!options.input) {
      throw new Error('Usage: npm run enrich -- --input <reactor.csv> [--run-dir ...] [--resume ...]');
    }
    inputPath = resolvePath(options.input);
    runDir = options.runDir ? resolveRunDir(options.runDir) : resolve(packageRoot, createRunDir());
  }

  mkdirSync(runDir, { recursive: true });

  const rawRows = readCsv(inputPath).map(toScrapeRow);
  let unique = dedupeProfiles(rawRows);
  unique = truncateRows(unique, options.maxRows);

  if (!checkpoint) {
    checkpoint = createCheckpoint(inputPath, unique.length);
  } else if (checkpoint.total_unique !== unique.length && checkpoint.next_index === 0) {
    checkpoint.total_unique = unique.length;
    checkpoint.stats.unique_profiles = unique.length;
  }

  const counter = new CallCounter();
  counter.merge(checkpoint.api_calls);

  const apolloOptions: ApolloClientOptions = {
    useFixtures: fixtures,
    counter,
  };

  console.log(`Email-from-LinkedIn enrich`);
  console.log(`  input: ${inputPath}`);
  console.log(`  run_dir: ${runDir}`);
  console.log(`  unique_profiles: ${unique.length} (from ${rawRows.length} rows)`);
  console.log(`  fixtures: ${fixtures ? 'yes' : 'no'}`);
  if (options.maxApolloCalls != null) {
    console.log(`  max_apollo_calls: ${options.maxApolloCalls}`);
  }
  if (checkpoint.next_index > 0) {
    console.log(`  resume_from: ${checkpoint.next_index}`);
  }

  const results = [...checkpoint.results];
  const doneUrls = new Set(results.map((row) => row.linkedin_url));

  for (let i = checkpoint.next_index; i < unique.length; i++) {
    if (options.maxApolloCalls != null && counter.counts.apollo_people_calls >= options.maxApolloCalls) {
      console.log(`\n  Stopping: max Apollo calls reached (${options.maxApolloCalls})`);
      break;
    }

    const profile = unique[i]!;
    if (doneUrls.has(profile.linkedinUrl)) {
      checkpoint.next_index = i + 1;
      continue;
    }

    const { row } = await enrichReactorProfile(profile.sample, profile.linkedinUrl, apolloOptions);
    results.push(row);
    doneUrls.add(row.linkedin_url);
    bumpStat(checkpoint.stats, row.enrichment_status);

    checkpoint.next_index = i + 1;
    checkpoint.results = results;
    checkpoint.api_calls = counter.snapshot();
    saveCheckpoint(runDir, checkpoint);
    writeOutputs(runDir, results);
    appendEnrichmentLog(runDir, {
      linkedin_url: row.linkedin_url,
      reactor_name: row.reactor_name,
      enrichment_status: row.enrichment_status,
      match_method: row.match_method,
      email: row.email,
      error: row.error || undefined,
      stats: { ...checkpoint.stats },
      api_calls: counter.snapshot(),
    });

    printProgress(checkpoint.stats.processed, unique.length, checkpoint.stats, counter.counts.apollo_people_calls);
  }

  writeOutputs(runDir, results);
  writeFullJoin(runDir, rawRows, results);

  const completedAll = checkpoint.next_index >= unique.length;
  checkpoint.status = completedAll ? 'completed' : 'in_progress';
  checkpoint.results = results;
  checkpoint.api_calls = counter.snapshot();
  saveCheckpoint(runDir, checkpoint);

  console.log(`\nDone.`);
  console.log(`  processed: ${checkpoint.stats.processed}`);
  console.log(`  email_found: ${checkpoint.stats.email_found}`);
  console.log(`  matched_no_email: ${checkpoint.stats.matched_no_email}`);
  console.log(`  not_found: ${checkpoint.stats.not_found}`);
  console.log(`  error: ${checkpoint.stats.error}`);
  console.log(`  apollo_people_calls: ${counter.counts.apollo_people_calls}`);
  console.log(`  outputs:`);
  console.log(`    ${join(runDir, 'enriched_unique.csv')}`);
  console.log(`    ${join(runDir, 'enriched_full.csv')}`);
  console.log(`    ${join(runDir, 'with_email.csv')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
