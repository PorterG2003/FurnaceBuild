import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, useFixtures, packageRoot, envInt } from '../lib/env.js';
import { loadQueriesConfig, buildSerpQuery } from '../lib/config.js';
import { writeCsv } from '../lib/csv.js';
import { parseCliArgs, createRunDir } from '../lib/cli.js';
import { STAGE1_COLUMNS, type Stage1Row } from '../lib/types.js';
import { CallCounter, ESTIMATED_SERP_PAGES_PER_QUERY } from '../lib/callCounter.js';
import { dedupeStage1Rows, filterAndMapSerpResults } from './parser.js';
import { mapSerpOrganic } from './serpTypes.js';
import { isLastSerpPage } from './serpPagination.js';
import { resolveSerperApiKey, serperSearchAllPagesForQuery } from './serperClient.js';
import { YieldStopTracker } from './yieldStop.js';
import {
  appendPageLog,
  assertCheckpointCompatible,
  createEmptyCheckpoint,
  csvPath,
  loadCheckpoint,
  markQuerySummary,
  mergePageRows,
  persistCheckpointState,
  seenUrlsFromCheckpoint,
  type QueryStopReason,
  type Stage1Checkpoint,
} from './stage1Checkpoint.js';
import {
  creditCeiling,
  logStage1Done,
  logStage1Page,
  logStage1QueryDone,
  logStage1QueryStart,
  logStage1Start,
} from './stage1ProgressLog.js';
import type { SmokeConfig } from '../lib/config.js';

export type Stage1Options = {
  outputPath?: string;
  runDir?: string;
  resumeRunDir?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  smokeLimits?: Partial<SmokeConfig>;
  counter?: CallCounter;
  useFixtures?: boolean;
};

function requireSerperApiKeyUnlessFixtures(useFixtureMode: boolean): void {
  if (useFixtureMode) return;
  if (!resolveSerperApiKey()) {
    throw new Error(
      'SERPER_API_KEY is required for live Stage 1 runs. Add it to .env.local or use USE_FIXTURES=1 / --fixtures for zero-cost tests.',
    );
  }
}

function resolveRunDir(options: Stage1Options, cli: ReturnType<typeof parseCliArgs>): string {
  const resumeDir = options.resumeRunDir ?? cli.resume;
  if (resumeDir) return resolve(resumeDir);

  if (options.runDir ?? cli.runDir) {
    return resolve(options.runDir ?? cli.runDir!);
  }

  if (options.outputPath) {
    return resolve(join(resolve(options.outputPath), '..'));
  }

  return resolve(packageRoot, createRunDir());
}

function yieldSummaryFromCheckpoint(checkpoint: Stage1Checkpoint): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const q of checkpoint.query_summaries) {
    if (q.stop_reason === 'pending') continue;
    summary[q.stop_reason] = (summary[q.stop_reason] ?? 0) + 1;
  }
  return summary;
}

export async function runStage1(options: Stage1Options = {}): Promise<{
  outputPath: string;
  rows: ReturnType<typeof dedupeStage1Rows>;
  stats: { queriesRun: number; rawResults: number; filtered: number; deduped: number };
}> {
  loadEnv();
  const cli = parseCliArgs();
  const queriesConfig = loadQueriesConfig();
  const useFixtureMode = options.useFixtures ?? cli.fixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const serperRateMs = envInt('SERPER_RATE_MS', queriesConfig.serper_rate_ms) ?? queriesConfig.serper_rate_ms;
  const yieldConfig = queriesConfig.yield_stop;

  const pageCap = options.smokeLimits?.max_pages ?? null;
  const queryLimit = options.smokeLimits?.max_queries ?? queriesConfig.phrases.length;
  const endPhraseIndex = Math.min(queryLimit, queriesConfig.phrases.length);
  const allPhrases = queriesConfig.phrases;

  requireSerperApiKeyUnlessFixtures(useFixtureMode);

  const resumed = Boolean(options.resumeRunDir ?? cli.resume);

  if (cli.dryRun || options.dryRun) {
    const pagesPerQuery = pageCap ?? ESTIMATED_SERP_PAGES_PER_QUERY;
    const estimate = {
      serper_searches: endPhraseIndex * pagesPerQuery,
      linkedin_navigations: 0,
      apollo_org_calls: 0,
      apollo_people_calls: 0,
      openrouter_calls: 0,
    };
    console.log(
      JSON.stringify({
        stage: 1,
        dry_run: true,
        queries: endPhraseIndex,
        total_phrases: allPhrases.length,
        serp_backend: 'serper',
        pagination: pageCap != null ? `capped_at_${pageCap}` : 'until_yield_or_exhausted',
        yield_stop: yieldConfig,
        estimate_note: 'Upper bound; yield stop typically reduces serper_searches significantly',
        estimate,
      }),
    );
    return {
      outputPath: '',
      rows: [],
      stats: { queriesRun: 0, rawResults: 0, filtered: 0, deduped: 0 },
    };
  }

  const runDir = resolveRunDir(options, cli);
  mkdirSync(runDir, { recursive: true });
  const outputPath = resolve(options.outputPath ?? cli.output ?? csvPath(runDir));

  let checkpoint: Stage1Checkpoint;
  if (resumed) {
    checkpoint = loadCheckpoint(runDir);
    assertCheckpointCompatible(checkpoint, queriesConfig);
    counter.counts.serper_searches = checkpoint.serper_searches;
  } else {
    checkpoint = createEmptyCheckpoint(queriesConfig, allPhrases);
    persistCheckpointState(runDir, checkpoint, [], new Set(), outputPath);
  }

  let rows: Stage1Row[] = [...checkpoint.rows];
  const seenUrls = seenUrlsFromCheckpoint(checkpoint);
  let rawCount = rows.length;
  let interrupted = false;

  const onSignal = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const collectedAt = checkpoint.started_at;
  let queriesRun = checkpoint.next_phrase_index;
  const ceiling = creditCeiling(endPhraseIndex, pageCap);

  logStage1Start({
    runDir,
    resumed,
    totalPhrases: allPhrases.length,
    endPhraseIndex,
    creditCeiling: ceiling,
    startingCredits: counter.counts.serper_searches,
    startingUnique: rows.length,
  });

  for (let phraseIndex = checkpoint.next_phrase_index; phraseIndex < endPhraseIndex; phraseIndex++) {
    if (interrupted) break;

    const phrase = allPhrases[phraseIndex]!;
    const searchQuery = buildSerpQuery(phrase);
    logStage1QueryStart(phraseIndex, endPhraseIndex, phrase);
    const yieldTracker = new YieldStopTracker(yieldConfig);
    let queryNewUrls = 0;
    let queryPagesFetched = 0;
    let stopReason: QueryStopReason = 'exhausted';

    markQuerySummary(checkpoint, phraseIndex, {
      phrase,
      search_query: searchQuery,
      pages_fetched: 0,
      new_urls: 0,
      stop_reason: 'pending',
    });

    const startPage = phraseIndex === checkpoint.next_phrase_index ? checkpoint.next_page : 1;
    let stopPagination = false;

    await serperSearchAllPagesForQuery({
      query: searchQuery,
      timeFilter: queriesConfig.time_filter,
      useFixtures: useFixtureMode,
      counter,
      pageCap,
      startPage,
      rateLimitMs: serperRateMs,
      shouldStop: () => stopPagination,
      onPage: async (serpPage, response) => {
        if (interrupted) {
          stopPagination = true;
          return;
        }

        const mapped = mapSerpOrganic(response, searchQuery, serpPage, collectedAt);
        const pageRows = filterAndMapSerpResults(mapped);
        const organicCount = response.organic?.length ?? 0;
        const linkedinCount = pageRows.length;

        const { rows: mergedRows, newUrlCount } = mergePageRows(rows, pageRows, seenUrls);
        rows = mergedRows;
        rawCount += pageRows.length;
        queryNewUrls += newUrlCount;
        queryPagesFetched++;

        const yieldAction = yieldTracker.recordPage(newUrlCount);
        let action = 'continue';
        if (yieldAction === 'stop_zero') {
          stopReason = 'yield_zero';
          stopPagination = true;
          action = 'stop_zero';
        } else if (yieldAction === 'stop_low_yield') {
          stopReason = 'yield_low';
          stopPagination = true;
          action = 'stop_low_yield';
        } else if (isLastSerpPage(organicCount)) {
          stopReason = 'exhausted';
          stopPagination = true;
          action = 'stop_exhausted';
        } else if (pageCap != null && serpPage >= pageCap) {
          stopReason = 'page_cap';
          stopPagination = true;
          action = 'stop_page_cap';
        }

        checkpoint.serper_searches = counter.counts.serper_searches;
        checkpoint.next_phrase_index = phraseIndex;
        checkpoint.next_page = stopPagination ? 1 : serpPage + 1;
        persistCheckpointState(runDir, checkpoint, rows, seenUrls, outputPath);

        const pageLog = {
          phrase_index: phraseIndex,
          search_query: searchQuery,
          serp_page: serpPage,
          organic_count: organicCount,
          linkedin_count: linkedinCount,
          new_urls: newUrlCount,
          cumulative_unique: rows.length,
          serper_searches: counter.counts.serper_searches,
          action,
        };
        appendPageLog(runDir, pageLog);
        console.log(JSON.stringify({ stage1_page: pageLog }));
        logStage1Page({
          phraseIndex,
          totalPhrases: endPhraseIndex,
          serpPage,
          creditsUsed: counter.counts.serper_searches,
          creditCeiling: ceiling,
          newUrls: newUrlCount,
          cumulativeUnique: rows.length,
          action,
          queryNewUrls,
          queryPages: queryPagesFetched,
        });
      },
    });

    if (interrupted) {
      stopReason = 'interrupted';
      markQuerySummary(checkpoint, phraseIndex, {
        pages_fetched: queryPagesFetched,
        new_urls: queryNewUrls,
        stop_reason: stopReason,
      });
      persistCheckpointState(runDir, checkpoint, rows, seenUrls, outputPath);
      break;
    }

    markQuerySummary(checkpoint, phraseIndex, {
      pages_fetched: queryPagesFetched,
      new_urls: queryNewUrls,
      stop_reason: stopReason,
    });

    logStage1QueryDone({
      phraseIndex,
      totalPhrases: endPhraseIndex,
      pagesFetched: queryPagesFetched,
      queryNewUrls,
      creditsUsed: counter.counts.serper_searches,
      cumulativeUnique: rows.length,
      stopReason,
    });

    checkpoint.next_phrase_index = phraseIndex + 1;
    checkpoint.next_page = 1;
    persistCheckpointState(runDir, checkpoint, rows, seenUrls, outputPath);
    queriesRun = phraseIndex + 1;
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  if (!interrupted && checkpoint.next_phrase_index >= allPhrases.length) {
    checkpoint.status = 'completed';
    checkpoint.next_page = 1;
    persistCheckpointState(runDir, checkpoint, rows, seenUrls, outputPath);
  }

  const deduped = rows;
  const maxRows = options.maxRows ?? cli.maxRows;
  const limited = maxRows ? deduped.slice(0, maxRows) : deduped;

  if (limited.length !== deduped.length) {
    writeCsv(outputPath, limited, [...STAGE1_COLUMNS]);
  }

  const stats = {
    queriesRun,
    rawResults: rawCount,
    filtered: rawCount,
    deduped: deduped.length,
  };

  console.log(
    JSON.stringify({
      stage: 1,
      serp_backend: 'serper',
      resumed,
      interrupted,
      run_dir: runDir,
      credit_ceiling: ceiling,
      ...stats,
      output: outputPath,
      api_calls: counter.snapshot(),
      yield_summary: yieldSummaryFromCheckpoint(checkpoint),
    }),
  );

  logStage1Done({
    interrupted,
    creditsUsed: counter.counts.serper_searches,
    creditCeiling: ceiling,
    cumulativeUnique: deduped.length,
    queriesRun,
    totalPhrases: allPhrases.length,
    runDir,
    yieldSummary: yieldSummaryFromCheckpoint(checkpoint),
  });

  if (interrupted) {
    process.exitCode = 130;
  }

  return { outputPath, rows: limited, stats };
}

export function writeRunManifest(runDir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(runDir, 'run_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runStage1().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
