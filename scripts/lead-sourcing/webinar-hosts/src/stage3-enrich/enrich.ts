import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ensureEnv, useFixtures, envBool } from '../lib/env.js';
import { readCsv } from '../lib/csv.js';
import { parseCliArgs } from '../lib/cli.js';
import { STAGE3_COLUMNS, rowToRecord, type Stage2Row, type Stage3Row } from '../lib/types.js';
import { CallCounter } from '../lib/callCounter.js';
import { sleepWithJitter } from '../lib/retry.js';
import { mapOrganization } from './apolloClient.js';
import { analyzePostText } from './postAnalyzer.js';
import { resolveCompany, totalApolloCalls } from './companyResolver.js';
import { expandRegistrationUrls, type ShortlinkCache } from './urlExpander.js';
import {
  appendEnrichmentLog,
  assertCheckpointCompatible,
  computeStage3Stats,
  createEmptyCheckpoint,
  defaultCsvPath,
  fingerprintFromGroups,
  loadCheckpoint,
  persistStage3State,
  type Stage3Checkpoint,
} from './stage3Checkpoint.js';
import { dedupeEntities } from './dedupeEntities.js';
import { logStage3Done, logStage3Group, logStage3Start } from './stage3ProgressLog.js';
import type { SmokeConfig } from '../lib/config.js';

export type Stage3Options = {
  inputPath: string;
  outputPath?: string;
  runDir?: string;
  resumeRunDir?: string;
  dryRun?: boolean;
  maxApolloCalls?: number | null;
  counter?: CallCounter;
  useFixtures?: boolean;
  smokeLimits?: Partial<SmokeConfig>;
  /** Test-only: exit loop after N groups without marking completed. */
  stopAfterGroups?: number;
};

export type EntityGroup = {
  key: string;
  rows: Stage2Row[];
};

export function groupKey(row: Stage2Row): string {
  return row.author_profile_url || row.author_name || row.result_url;
}

export function pickBestPost(rows: Stage2Row[]): Stage2Row {
  return (
    rows.find((r) => r.extraction_status === 'ok' && r.post_text) ??
    rows.find((r) => r.extraction_status === 'ok') ??
    rows[0]!
  );
}

export function buildEntityGroups(inputRows: Stage2Row[]): EntityGroup[] {
  const groupsMap = new Map<string, EntityGroup>();
  for (const row of inputRows) {
    const key = groupKey(row);
    const existing = groupsMap.get(key);
    if (existing) existing.rows.push(row);
    else groupsMap.set(key, { key, rows: [row] });
  }
  return [...groupsMap.values()];
}

function resolveRunDir(
  options: Stage3Options,
  cli: ReturnType<typeof parseCliArgs>,
  inputPath: string,
): string {
  const resumeDir = options.resumeRunDir ?? cli.resume;
  if (resumeDir) return resolve(resumeDir);

  if (options.runDir ?? cli.runDir) {
    return resolve(options.runDir ?? cli.runDir!);
  }

  return resolve(dirname(inputPath));
}

function mergedRegistrationUrls(group: EntityGroup): string[] {
  return [...new Set(group.rows.flatMap((r) => r.registration_urls.split('|').filter(Boolean)))];
}

export { dedupeEntities };

export async function runStage3(options: Stage3Options): Promise<{
  outputPath: string;
  rows: Stage3Row[];
  stats: { groups: number; enriched: number; partial: number; not_found: number };
  interrupted?: boolean;
}> {
  await ensureEnv();
  const cli = parseCliArgs();
  const useFixtureMode = options.useFixtures ?? cli.fixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const inputPath = resolve(options.inputPath);
  const inputRows = readCsv(inputPath) as Stage2Row[];

  let groups = buildEntityGroups(inputRows);
  const groupKeys = groups.map((g) => g.key);
  const fingerprint = fingerprintFromGroups(inputPath, groupKeys);

  const orgLimit = options.smokeLimits?.max_apollo_org_lookups;
  if (orgLimit != null && orgLimit > 0) {
    groups = groups.slice(0, orgLimit);
  }

  const maxApolloCalls = options.maxApolloCalls ?? cli.maxApolloCalls;

  if (cli.dryRun || options.dryRun) {
    const companyPageGroups = groups.filter((g) => pickBestPost(g.rows).entity_type === 'company').length;
    const personGroups = groups.filter((g) => pickBestPost(g.rows).entity_type === 'person').length;
    console.log(
      JSON.stringify({
        stage: 3,
        dry_run: true,
        entity_groups: groups.length,
        estimate: {
          apollo_org_calls_max: groups.length,
          apollo_people_calls_max: personGroups,
          apollo_org_calls_likely: companyPageGroups + Math.ceil(personGroups * 0.5),
          apollo_people_calls_likely: Math.ceil(personGroups * 0.2),
          openrouter_calls: envBool('OPENROUTER_API_KEY') ? groups.length : 0,
          note: 'Free pre-resolution (registration domains, post signals) reduces paid calls before person-employer fallback',
        },
      }),
    );
    return { outputPath: '', rows: [], stats: { groups: groups.length, enriched: 0, partial: 0, not_found: 0 } };
  }

  const runDir = resolveRunDir(options, cli, inputPath);
  mkdirSync(runDir, { recursive: true });
  const outputPath = resolve(options.outputPath ?? cli.output ?? defaultCsvPath(runDir));
  const resumed = Boolean(options.resumeRunDir ?? cli.resume);

  let checkpoint: Stage3Checkpoint;
  let shortlinkCache: ShortlinkCache = {};

  if (resumed) {
    checkpoint = loadCheckpoint(runDir);
    assertCheckpointCompatible(checkpoint, inputPath, fingerprint);
    counter.counts = { ...checkpoint.api_calls };
    shortlinkCache = { ...checkpoint.shortlink_cache };
  } else {
    checkpoint = createEmptyCheckpoint({
      inputPath,
      inputFingerprint: fingerprint,
      outputPath,
      totalGroups: groups.length,
    });
    persistStage3State(runDir, checkpoint, [], outputPath);
  }

  let results: Stage3Row[] = [...checkpoint.rows];
  let startIndex = checkpoint.next_group_index;
  let interrupted = false;

  const onSignal = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const apolloBudgetRemaining = (): boolean => {
    if (maxApolloCalls == null || maxApolloCalls <= 0) return true;
    return totalApolloCalls(counter) < maxApolloCalls;
  };

  logStage3Start({
    runDir,
    inputPath,
    resumed,
    totalGroups: groups.length,
    startingGroup: startIndex,
    startingApiCalls: totalApolloCalls(counter),
    maxApolloCalls,
  });

  const apolloOptions = { useFixtures: useFixtureMode, counter };
  const openRouterEnabled =
    Boolean(process.env.OPENROUTER_API_KEY?.trim()) &&
    (options.smokeLimits?.max_openrouter_calls ?? Number.MAX_SAFE_INTEGER) > 0;

  const orgCache = new Map<string, ReturnType<typeof mapOrganization>>();

  for (let i = startIndex; i < groups.length; i++) {
    if (interrupted) break;

    const group = groups[i]!;
    const best = pickBestPost(group.rows);
    const regUrls = mergedRegistrationUrls(group);

    const { expanded, cache } = await expandRegistrationUrls(regUrls, shortlinkCache, {
      useFixtures: useFixtureMode,
    });
    shortlinkCache = cache;

    const resolved = await resolveCompany(best, expanded, {
      apolloOptions,
      apolloBudgetRemaining,
    });

    const cacheKey =
      resolved.mapped.apollo_org_id ||
      resolved.mapped.company_domain ||
      resolved.mapped.company_name ||
      group.key;
    if (!orgCache.has(cacheKey)) orgCache.set(cacheKey, resolved.mapped);
    const canonical = orgCache.get(cacheKey)!;

    const analysis = openRouterEnabled
      ? await analyzePostText(best.post_text, {
          useFixtures: useFixtureMode,
          counter,
          enabled: openRouterEnabled,
        })
      : { webinar_topic: '', webinar_date_mention: '', target_audience: '' };

    const entityRow = rowToRecord({
      ...canonical,
      webinar_topic: analysis.webinar_topic,
      webinar_date_mention: analysis.webinar_date_mention,
      target_audience: analysis.target_audience,
      registration_urls: regUrls.join('|'),
      sample_post_url: best.result_url,
      post_count: group.rows.length,
      entity_source: resolved.entitySource,
      enrichment_status: resolved.enrichmentStatus,
    }) as Stage3Row;

    results.push(entityRow);

    checkpoint.next_group_index = i + 1;
    checkpoint.api_calls = counter.snapshot();
    checkpoint.shortlink_cache = shortlinkCache;
    persistStage3State(runDir, checkpoint, results, outputPath);

    const stats = computeStage3Stats(dedupeEntities(results));
    const logEntry = {
      group_index: i,
      group_key: group.key,
      entity_source: resolved.entitySource,
      enrichment_status: resolved.enrichmentStatus,
      company_name: canonical.company_name,
      api_calls: counter.snapshot(),
      stats,
    };
    appendEnrichmentLog(runDir, logEntry);
    console.log(JSON.stringify({ stage3_group: logEntry }));

    const done = i + 1;
    if (done === 1 || done === groups.length || done % 25 === 0) {
      logStage3Group({
        done,
        total: groups.length,
        stats,
        apolloCalls: totalApolloCalls(counter),
        lastCompany: canonical.company_name || group.key,
      });
    }

    if (options.stopAfterGroups != null && done >= options.stopAfterGroups) {
      break;
    }

    if (!useFixtureMode) await sleepWithJitter(1000, 200);
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  if (!interrupted && checkpoint.next_group_index >= groups.length) {
    checkpoint.status = 'completed';
    persistStage3State(runDir, checkpoint, results, outputPath);
  }

  const deduped = dedupeEntities(results);
  const stats = {
    groups: groups.length,
    enriched: deduped.filter((r) => r.enrichment_status === 'ok').length,
    partial: deduped.filter((r) => r.enrichment_status === 'partial').length,
    not_found: deduped.filter((r) => r.enrichment_status === 'not_found').length,
  };

  console.log(
    JSON.stringify({
      stage: 3,
      resumed,
      interrupted,
      run_dir: runDir,
      ...stats,
      output: outputPath,
      api_calls: counter.snapshot(),
    }),
  );

  logStage3Done({
    interrupted,
    total: groups.length,
    stats: computeStage3Stats(deduped),
    apolloCalls: totalApolloCalls(counter),
    runDir,
    inputPath,
    outputPath,
  });

  if (interrupted) {
    process.exitCode = 130;
  }

  return { outputPath, rows: deduped, stats, interrupted };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const cli = parseCliArgs();
  if (!cli.input) {
    console.error('Usage: npm run stage3 -- --input path/to/stage2.csv [--resume runDir] [--max-apollo-calls N]');
    process.exit(1);
  }
  runStage3({
    inputPath: cli.input,
    resumeRunDir: cli.resume,
    runDir: cli.runDir,
    outputPath: cli.output,
    maxApolloCalls: cli.maxApolloCalls,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
