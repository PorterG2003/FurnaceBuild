import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadEnv, useFixtures, fixturesDir, envInt, scrapeProfiles } from '../lib/env.js';
import { readCsv } from '../lib/csv.js';
import { parseCliArgs, truncateRows } from '../lib/cli.js';
import { sleepWithJitter } from '../lib/retry.js';
import { rowToRecord, type Stage1Row, type Stage2Row } from '../lib/types.js';
import { CallCounter } from '../lib/callCounter.js';
import { linkedInFixtureKey } from '../stage1-serp/parser.js';
import { parseLinkedInPostHtml, parseLinkedInProfileHtml, linkedInProfileFixtureKey } from './linkedinParser.js';
import {
  appendExtractionLog,
  assertCheckpointCompatible,
  computeStage2Stats,
  createEmptyCheckpoint,
  defaultCsvPath,
  errorRowIndices,
  fingerprintFromInput,
  loadCheckpoint,
  persistCheckpointState,
  STAGE2_COLUMNS,
  type Stage2Checkpoint,
} from './stage2Checkpoint.js';
import { logStage2Done, logStage2Row, logStage2Start } from './stage2ProgressLog.js';
import type { SmokeConfig } from '../lib/config.js';

export type Stage2Options = {
  inputPath: string;
  outputPath?: string;
  runDir?: string;
  resumeRunDir?: string;
  retryErrors?: boolean;
  dryRun?: boolean;
  maxRows?: number | null;
  smokeLimits?: Partial<SmokeConfig>;
  counter?: CallCounter;
  useFixtures?: boolean;
  /** Test-only: exit loop after N rows without marking completed. */
  stopAfterRows?: number;
};

export function loadFixtureHtml(url: string): string {
  const key = linkedInFixtureKey(url);
  return readFileSync(join(fixturesDir, 'linkedin', `${key}.html`), 'utf8');
}

export function loadProfileFixtureHtml(profileUrl: string): string {
  const key = linkedInProfileFixtureKey(profileUrl);
  return readFileSync(join(fixturesDir, 'linkedin', `${key}.html`), 'utf8');
}

function resolveRunDir(
  options: Stage2Options,
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

async function createLinkedInContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const liAt = process.env.LINKEDIN_LI_AT?.trim();
  if (liAt) {
    await context.addCookies([
      {
        name: 'li_at',
        value: liAt,
        domain: '.linkedin.com',
        path: '/',
      },
    ]);
  }
  return context;
}

async function fetchPostHtml(
  page: Page,
  url: string,
  options: { counter?: CallCounter; saveRawHtmlDir?: string },
): Promise<string> {
  options.counter?.increment('linkedin_navigations');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page
    .waitForSelector('meta[property="og:title"], script[type="application/ld+json"]', {
      timeout: 8_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(200);
  const html = await page.content();

  if (options.saveRawHtmlDir) {
    mkdirSync(options.saveRawHtmlDir, { recursive: true });
    const slug = url.split('/posts/')[1]?.replace(/[^\w-]+/g, '_').slice(0, 60) ?? 'post';
    writeFileSync(join(options.saveRawHtmlDir, `${slug}.html`), html, 'utf8');
  }

  return html;
}

function extractRowFromHtml(row: Stage1Row, html: string): Stage2Row {
  const parsed = parseLinkedInPostHtml(html);
  return rowToRecord({
    ...row,
    post_text: parsed.post_text,
    author_name: parsed.author_name,
    author_profile_url: parsed.author_profile_url,
    author_employer_name: '',
    author_employer_linkedin_url: '',
    entity_type: parsed.entity_type,
    registration_urls: parsed.registration_urls.join('|'),
    posted_at: parsed.posted_at,
    extraction_status: parsed.extraction_status,
    extraction_error: parsed.extraction_error,
  }) as Stage2Row;
}

async function enrichPersonWithProfile(
  row: Stage2Row,
  options: {
    useFixtureMode: boolean;
    page: Page | null;
    counter?: CallCounter;
    saveRawHtmlDir?: string;
    rateMs: number;
  },
): Promise<Stage2Row> {
  if (!scrapeProfiles()) return row;
  if (row.entity_type !== 'person') return row;
  if (!row.author_profile_url || !/\/in\//i.test(row.author_profile_url)) return row;

  if (!options.useFixtureMode && options.rateMs > 0) {
    await sleepWithJitter(options.rateMs);
  }

  try {
    const html = options.useFixtureMode
      ? loadProfileFixtureHtml(row.author_profile_url)
      : await fetchPostHtml(options.page!, row.author_profile_url, {
          counter: options.counter,
          saveRawHtmlDir: options.saveRawHtmlDir,
        });
    const profile = parseLinkedInProfileHtml(html);
    return rowToRecord({
      ...row,
      author_employer_name: profile.employer_name,
      author_employer_linkedin_url: profile.employer_linkedin_url,
    }) as Stage2Row;
  } catch {
    return row;
  }
}

function errorRow(row: Stage1Row, error: unknown): Stage2Row {
  return rowToRecord({
    ...row,
    post_text: '',
    author_name: '',
    author_profile_url: '',
    author_employer_name: '',
    author_employer_linkedin_url: '',
    entity_type: 'unknown',
    registration_urls: '',
    posted_at: '',
    extraction_status: 'error',
    extraction_error: error instanceof Error ? error.message : String(error),
  }) as Stage2Row;
}

function rowIndicesToProcess(
  retryErrors: boolean,
  results: Stage2Row[],
  startIndex: number,
  length: number,
): number[] {
  if (retryErrors) return errorRowIndices(results);
  const indices: number[] = [];
  for (let i = startIndex; i < length; i++) indices.push(i);
  return indices;
}

export async function runStage2(options: Stage2Options): Promise<{
  outputPath: string;
  rows: Stage2Row[];
  stats: { input: number; ok: number; blocked: number; error: number };
}> {
  loadEnv();
  const cli = parseCliArgs();
  const useFixtureMode = options.useFixtures ?? cli.fixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const inputPath = resolve(options.inputPath);

  const inputRows = readCsv(inputPath) as Stage1Row[];
  const maxRows =
    options.smokeLimits?.max_linkedin_urls ??
    options.maxRows ??
    cli.maxRows ??
    inputRows.length;
  const limitedInput = truncateRows(inputRows, maxRows);
  const effectiveMaxRows = maxRows ?? inputRows.length;

  if (cli.dryRun || options.dryRun) {
    const profileMultiplier = scrapeProfiles() ? 2 : 1;
    console.log(
      JSON.stringify({
        stage: 2,
        dry_run: true,
        input_rows: limitedInput.length,
        scrape_profiles: scrapeProfiles(),
        estimate: { linkedin_navigations: limitedInput.length * profileMultiplier },
      }),
    );
    return {
      outputPath: '',
      rows: [],
      stats: { input: limitedInput.length, ok: 0, blocked: 0, error: 0 },
    };
  }

  const runDir = resolveRunDir(options, cli, inputPath);
  mkdirSync(runDir, { recursive: true });
  const outputPath = resolve(options.outputPath ?? cli.output ?? defaultCsvPath(runDir));
  const fingerprint = fingerprintFromInput(inputPath, effectiveMaxRows, inputRows);
  const retryErrors = options.retryErrors ?? cli.retryErrors;
  const resumed = Boolean(options.resumeRunDir ?? cli.resume) || retryErrors;
  const saveRawHtmlDir = process.env.SAVE_RAW_HTML_DIR?.trim();
  const rateMs = envInt('RATE_MS', 1500) ?? 1500;

  let checkpoint: Stage2Checkpoint;
  if (resumed) {
    checkpoint = loadCheckpoint(runDir);
    assertCheckpointCompatible(checkpoint, inputPath, fingerprint, {
      allowCompleted: retryErrors,
    });
    counter.counts.linkedin_navigations = checkpoint.linkedin_navigations;
  } else {
    checkpoint = createEmptyCheckpoint({
      inputPath,
      inputFingerprint: fingerprint,
      outputPath,
      totalRows: limitedInput.length,
    });
    persistCheckpointState(runDir, checkpoint, [], outputPath);
  }

  let results: Stage2Row[] = [...checkpoint.rows];
  const startIndex = checkpoint.next_row_index;
  let interrupted = false;
  let retryIndices: number[] = [];

  if (retryErrors) {
    if (results.length !== limitedInput.length) {
      throw new Error(
        `Cannot retry errors: checkpoint has ${results.length} rows but input has ${limitedInput.length}.`,
      );
    }
    retryIndices = errorRowIndices(results);
    if (retryIndices.length === 0) {
      console.log(JSON.stringify({ stage: 2, retry_errors: true, message: 'No error rows to retry.' }));
      return {
        outputPath,
        rows: results,
        stats: { input: limitedInput.length, ...computeStage2Stats(results) },
      };
    }
    checkpoint.status = 'in_progress';
    persistCheckpointState(runDir, checkpoint, results, outputPath);
  }

  const indicesToProcess = rowIndicesToProcess(retryErrors, results, startIndex, limitedInput.length);

  const onSignal = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  logStage2Start({
    runDir,
    inputPath,
    resumed,
    retryErrors,
    totalRows: limitedInput.length,
    startingRow: retryErrors ? 0 : startIndex,
    retryCount: retryErrors ? retryIndices.length : undefined,
    startingNavigations: counter.counts.linkedin_navigations,
    liAtSet: Boolean(process.env.LINKEDIN_LI_AT?.trim()),
  });

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    if (!useFixtureMode) {
      browser = await chromium.launch({ headless: true });
      const context = await createLinkedInContext(browser);
      page = await context.newPage();
      page.setDefaultTimeout(60_000);
    }

    let processed = 0;
    for (const i of indicesToProcess) {
      if (interrupted) break;

      if (!useFixtureMode && rateMs > 0 && (retryErrors || i > startIndex)) {
        await sleepWithJitter(rateMs);
      }

      const row = limitedInput[i]!;
      let extracted: Stage2Row;
      try {
        const html = useFixtureMode
          ? loadFixtureHtml(row.result_url)
          : await fetchPostHtml(page!, row.result_url, { counter, saveRawHtmlDir });
        extracted = extractRowFromHtml(row, html);
        extracted = await enrichPersonWithProfile(extracted, {
          useFixtureMode,
          page,
          counter,
          saveRawHtmlDir,
          rateMs: retryErrors ? 0 : rateMs,
        });
      } catch (error) {
        extracted = errorRow(row, error);
      }

      if (retryErrors) {
        results[i] = extracted;
      } else {
        results.push(extracted);
        checkpoint.next_row_index = i + 1;
      }

      checkpoint.linkedin_navigations = counter.counts.linkedin_navigations;
      persistCheckpointState(runDir, checkpoint, results, outputPath);

      const stats = computeStage2Stats(results);
      const logEntry = {
        row_index: i,
        result_url: row.result_url,
        extraction_status: extracted.extraction_status,
        retry: retryErrors,
        linkedin_navigations: counter.counts.linkedin_navigations,
        stats,
      };
      appendExtractionLog(runDir, logEntry);
      console.log(JSON.stringify({ stage2_row: logEntry }));

      processed += 1;
      const done = retryErrors ? processed : i + 1;
      const total = retryErrors ? retryIndices.length : limitedInput.length;
      if (done === 1 || done === total || done % 25 === 0) {
        logStage2Row({
          done,
          total,
          stats,
          linkedinNavigations: counter.counts.linkedin_navigations,
          lastUrl: row.result_url,
        });
      }

      if (options.stopAfterRows != null && !retryErrors && done >= options.stopAfterRows) {
        break;
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  const finished =
    !interrupted &&
    (retryErrors ? true : checkpoint.next_row_index >= limitedInput.length);

  if (finished) {
    checkpoint.status = 'completed';
    persistCheckpointState(runDir, checkpoint, results, outputPath);
  }

  const stats = {
    input: limitedInput.length,
    ...computeStage2Stats(results),
  };

  console.log(
    JSON.stringify({
      stage: 2,
      resumed,
      retry_errors: retryErrors,
      interrupted,
      run_dir: runDir,
      ...stats,
      output: outputPath,
      api_calls: counter.snapshot(),
    }),
  );

  logStage2Done({
    interrupted,
    total: limitedInput.length,
    stats: computeStage2Stats(results),
    linkedinNavigations: counter.counts.linkedin_navigations,
    runDir,
    inputPath,
    outputPath,
  });

  if (interrupted) {
    process.exitCode = 130;
  }

  return { outputPath, rows: results, stats };
}

export { STAGE2_COLUMNS };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const cli = parseCliArgs();
  if (!cli.input) {
    console.error(
      'Usage: npm run stage2 -- --input path/to/stage1.csv [--resume runDir] [--retry-errors]',
    );
    process.exit(1);
  }
  if (cli.retryErrors && !cli.resume) {
    console.error('Usage: --retry-errors requires --resume <runDir>');
    process.exit(1);
  }
  runStage2({
    inputPath: cli.input,
    resumeRunDir: cli.resume,
    runDir: cli.runDir,
    outputPath: cli.output,
    maxRows: cli.maxRows,
    retryErrors: cli.retryErrors,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
