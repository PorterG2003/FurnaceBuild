import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { runMetaAdLibraryLookup, type MetaAdLibraryLookupResult } from './metaAdLibraryLookup.js';
import {
  isEmptyNoResult,
  pickSessionRotationInterval,
  pickSlowMoMs,
  shouldRetryEmptyNoResult,
  sleepRandom,
} from './metaAdsAntiBot.js';
import {
  checkpointArgsMatch,
  createEmptyCheckpoint,
  loadCheckpoint,
  markCheckpointCompleted,
  recordCheckpointError,
  saveCheckpoint,
  type MetaAdsBatchCheckpoint,
  type MetaAdsBatchCheckpointArgs,
} from './metaAdLibraryBatchCheckpoint.js';
import { loadCsv, pickRows, SAMPLE_NAMES, type CsvRow } from './pilotBatchRows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-06-webinar-hosts/stage3_webinar_host_entities.csv';

const DEFAULT_RUNS_ROOT =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs';
const DEFAULT_SAMPLE_OUT_DIR = `${DEFAULT_RUNS_ROOT}/2026-06-webinar-hosts/meta-ads-sample`;
const DEFAULT_FULL_OUT_DIR = `${DEFAULT_RUNS_ROOT}/2026-06-webinar-hosts/meta-ads-playwright`;
const DEFAULT_PILOT_OUT_DIR = `${DEFAULT_RUNS_ROOT}/2026-06-webinar-hosts/meta-ads-pilot-playwright`;
const DEFAULT_DELAY_MIN_MS = 8_000;
const DEFAULT_DELAY_MAX_MS = 18_000;
const DEFAULT_RETRY_MIN_MS = 20_000;
const DEFAULT_RETRY_MAX_MS = 45_000;
const DEFAULT_MAX_NO_RESULT_RETRIES = 2;
const DEFAULT_ROTATE_SESSION_EVERY = 20;

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

type AntiBotConfig = {
  delayMinMs: number;
  delayMaxMs: number;
  retryNoResults: boolean;
  maxNoResultRetries: number;
  retryMinMs: number;
  retryMaxMs: number;
  rotateSessionEvery: number;
};

async function lookupWithRetry(
  row: CsvRow,
  options: {
    headless: boolean;
    outDir: string;
    scanWebinars: boolean;
    webinarScanDays: number;
    browser: Browser;
    context: BrowserContext;
    antiBot: AntiBotConfig;
    rotateSession: () => Promise<BrowserContext>;
  },
): Promise<{ result: MetaAdLibraryLookupResult; lookupAttempts: number; context: BrowserContext }> {
  const domain = row.company_domain.trim();
  const companyName = row.company_name.trim();
  let context = options.context;
  let lookupAttempts = 0;
  let result: MetaAdLibraryLookupResult | null = null;

  const maxAttempts = options.antiBot.retryNoResults ? options.antiBot.maxNoResultRetries + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lookupAttempts += 1;
    if (attempt > 0) {
      process.stderr.write(
        `  retry ${attempt}/${options.antiBot.maxNoResultRetries} for ${companyName} (empty no_results) — rotating session\n`,
      );
      context = await options.rotateSession();
      await sleepRandom(options.antiBot.retryMinMs, options.antiBot.retryMaxMs);
    }

    result = await runMetaAdLibraryLookup({
      domain,
      companyName,
      headless: options.headless,
      timeoutMs: 45_000,
      outputDir: options.outDir,
      scanWebinars: options.scanWebinars,
      webinarScanDays: options.webinarScanDays,
      browser: options.browser,
      context,
    });

    if (!shouldRetryEmptyNoResult(result, attempt, options.antiBot.maxNoResultRetries)) {
      break;
    }
  }

  return { result: result!, lookupAttempts, context };
}

async function rotateBrowserContext(
  browser: Browser,
  context: BrowserContext | null,
): Promise<BrowserContext> {
  if (context) {
    await context.close().catch(() => undefined);
  }
  await sleepRandom(3_000, 8_000);
  return browser.newContext({
    viewport: BATCH_VIEWPORT,
    ignoreHTTPSErrors: true,
  });
}

  row: CsvRow,
  result: MetaAdLibraryLookupResult,
  extra?: { lookup_attempts?: number; empty_no_result?: boolean },
): Record<string, unknown> {
  const webinarScan = result.signals.webinar_scan as
    | {
        enabled?: boolean;
        webinar_ad_count?: number;
        webinar_ads?: unknown[];
        recent_ad_count?: number;
        scanned_card_count?: number;
        pagination?: {
          initial_card_count?: number;
          cards_added_by_scroll?: number;
          scroll_helped?: boolean;
          scroll_attempts?: number;
          stopped_reason?: string;
        };
      }
    | undefined;
  return {
    company_name: row.company_name.trim(),
    company_domain: row.company_domain.trim(),
    employee_count: row.employee_count,
    industry: row.industry,
    post_count: row.post_count,
    meta_ads_result: result.result,
    matched_page_name: result.matched_page_name,
    matched_via: result.signals.matched_via ?? null,
    matched_ad_count: result.signals.matched_ad_count ?? 0,
    matched_ads: result.signals.matched_ads ?? [],
    top_ad: result.signals.top_ad ?? null,
    top_ad_primary_text: (result.signals.top_ad as { primary_text?: string | null } | null)?.primary_text ?? null,
    top_ad_landing_url: (result.signals.top_ad as { landing_url?: string | null } | null)?.landing_url ?? null,
    webinar_scan_enabled: webinarScan?.enabled ?? false,
    webinar_ad_count: webinarScan?.webinar_ad_count ?? 0,
    webinar_ads: webinarScan?.webinar_ads ?? [],
    recent_ad_count: webinarScan?.recent_ad_count ?? 0,
    scanned_card_count: webinarScan?.scanned_card_count ?? 0,
    initial_card_count: webinarScan?.pagination?.initial_card_count ?? result.signals.result_card_count ?? 0,
    cards_added_by_scroll: webinarScan?.pagination?.cards_added_by_scroll ?? 0,
    scroll_helped: webinarScan?.pagination?.scroll_helped ?? false,
    scroll_attempts: webinarScan?.pagination?.scroll_attempts ?? 0,
    scroll_stopped_reason: webinarScan?.pagination?.stopped_reason ?? null,
    search_attempts: result.signals.search_attempts,
    error: result.error ?? null,
    elapsed_ms: result.lookup_stats.elapsed_ms,
    lookup_attempts: extra?.lookup_attempts ?? 1,
    empty_no_result: extra?.empty_no_result ?? isEmptyNoResult(result),
  };
}

const FLAGS_WITH_VALUE = new Set([
  '--out-dir',
  '--checkpoint',
  '--max-rows',
  '--delay-min-ms',
  '--delay-max-ms',
  '--retry-min-ms',
  '--retry-max-ms',
  '--max-no-result-retries',
  '--rotate-session-every',
  '--webinar-days',
]);

function positionalArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = positionalArgs(argv);
  const headless = hasFlag(argv, '--headless');
  const scanWebinars = hasFlag(argv, '--scan-webinars');
  const resume = hasFlag(argv, '--resume');
  const fresh = hasFlag(argv, '--fresh');
  const batchAll = hasFlag(argv, '--all');
  const pilot = hasFlag(argv, '--pilot');
  const retryNoResults = hasFlag(argv, '--retry-no-results');
  const webinarDaysFlag = argv.indexOf('--webinar-days');
  const webinarScanDays =
    webinarDaysFlag >= 0 ? Number(argv[webinarDaysFlag + 1] ?? 30) : 30;
  const maxRowsFlag = readFlag(argv, '--max-rows');
  const maxRows = maxRowsFlag ? Number(maxRowsFlag) : pilot ? 150 : null;
  const antiBot: AntiBotConfig = {
    delayMinMs: Number(readFlag(argv, '--delay-min-ms') ?? DEFAULT_DELAY_MIN_MS),
    delayMaxMs: Number(readFlag(argv, '--delay-max-ms') ?? DEFAULT_DELAY_MAX_MS),
    retryNoResults,
    maxNoResultRetries: Number(readFlag(argv, '--max-no-result-retries') ?? DEFAULT_MAX_NO_RESULT_RETRIES),
    retryMinMs: Number(readFlag(argv, '--retry-min-ms') ?? DEFAULT_RETRY_MIN_MS),
    retryMaxMs: Number(readFlag(argv, '--retry-max-ms') ?? DEFAULT_RETRY_MAX_MS),
    rotateSessionEvery: Number(readFlag(argv, '--rotate-session-every') ?? DEFAULT_ROTATE_SESSION_EVERY),
  };
  const csvPath = resolve(__dirname, positional[0] ?? DEFAULT_CSV);
  const batchMode = batchAll ? 'all' : 'sample';

  const rows = loadCsv(csvPath);
  const batchRows = pickRows(rows, batchMode, maxRows, pilot);
  if (batchRows.length === 0) throw new Error('No rows to process');

  const defaultOutDir = pilot
    ? DEFAULT_PILOT_OUT_DIR
    : batchMode === 'all'
      ? DEFAULT_FULL_OUT_DIR
      : DEFAULT_SAMPLE_OUT_DIR;
  const outDir = resolve(__dirname, readFlag(argv, '--out-dir') ?? defaultOutDir);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'webinar-batch-results.json');
  const checkpointPath = resolve(outDir, readFlag(argv, '--checkpoint') ?? 'webinar-batch-checkpoint.json');

  const checkpointArgs: MetaAdsBatchCheckpointArgs = {
    csvPath,
    outDir,
    headless,
    scanWebinars,
    webinarScanDays,
    batchMode,
    maxRows,
    sampleNames: batchMode === 'sample' ? SAMPLE_NAMES : [],
    pilot,
    antiBot,
  };

  let checkpoint: MetaAdsBatchCheckpoint;
  if (resume && !fresh) {
    const loaded = loadCheckpoint(checkpointPath);
    if (!loaded) throw new Error(`No checkpoint found at ${checkpointPath}`);
    checkpointArgsMatch(loaded, checkpointArgs);
    checkpoint = loaded;
    process.stderr.write(
      `Resuming batch from checkpoint (${checkpoint.completedDomains.length}/${batchRows.length} complete)\n`,
    );
  } else {
    checkpoint = createEmptyCheckpoint(checkpointArgs);
    if (!fresh && loadCheckpoint(checkpointPath)) {
      process.stderr.write(`Starting fresh batch (ignoring existing checkpoint at ${checkpointPath})\n`);
    }
  }

  const completed = new Set(checkpoint.completedDomains);
  const startedAt = Date.now();
  let processedThisRun = 0;
  let consecutiveEmptyNoResults = 0;
  let lookupsSinceRotation = 0;
  let nextRotationAt = pickSessionRotationInterval(antiBot.rotateSessionEvery);

  process.stderr.write(
    [
      '[meta-ads-batch] starting',
      `  mode: ${batchMode}${pilot ? ' (pilot)' : ''}`,
      `  rows: ${batchRows.length}`,
      `  headed: ${!headless}`,
      `  scan_webinars: ${scanWebinars}`,
      `  delay_ms: ${antiBot.delayMinMs}-${antiBot.delayMaxMs}`,
      `  retry_no_results: ${retryNoResults}`,
      `  rotate_session_every: ~${antiBot.rotateSessionEvery}`,
      `  out_dir: ${outDir}`,
      `  checkpoint: ${checkpointPath}`,
    ].join('\n') + '\n',
  );

  acquireBatchLock(outDir);
  const { browser, context: initialContext } = await launchBatchBrowser(headless);
  let context = initialContext;

  const rotateSession = async (): Promise<BrowserContext> => {
    context = await rotateBrowserContext(browser, context);
    lookupsSinceRotation = 0;
    nextRotationAt = pickSessionRotationInterval(antiBot.rotateSessionEvery);
    return context;
  };

  try {
    for (const row of batchRows) {
      const domain = row.company_domain.trim();
      const companyName = row.company_name.trim();
      if (completed.has(domain)) {
        process.stderr.write(`Skipping ${companyName} (${domain}) — already in checkpoint\n`);
        continue;
      }

      if (processedThisRun > 0) {
        await sleepRandom(antiBot.delayMinMs, antiBot.delayMaxMs);
      }

      if (lookupsSinceRotation >= nextRotationAt) {
        process.stderr.write(`Rotating browser session after ${lookupsSinceRotation} lookups\n`);
        context = await rotateSession();
      }

      process.stderr.write(`Looking up ${companyName} (${domain})...\n`);
      try {
        const { result, lookupAttempts, context: updatedContext } = await lookupWithRetry(row, {
          headless,
          outDir,
          scanWebinars,
          webinarScanDays,
          browser,
          context,
          antiBot,
          rotateSession,
        });
        context = updatedContext;

        const emptyNoResult = isEmptyNoResult(result);
        if (emptyNoResult) {
          consecutiveEmptyNoResults += 1;
        } else {
          consecutiveEmptyNoResults = 0;
        }

        if (consecutiveEmptyNoResults >= 10 && processedThisRun >= 9) {
          process.stderr.write(
            `[meta-ads-batch] ${consecutiveEmptyNoResults} consecutive empty no_results — backing off 90-120s and rotating session\n`,
          );
          await sleepRandom(90_000, 120_000);
          context = await rotateSession();
          consecutiveEmptyNoResults = 0;
        }

        const formatted = formatBatchResult(row, result, {
          lookup_attempts: lookupAttempts,
          empty_no_result: emptyNoResult,
        });
        markCheckpointCompleted(checkpoint, domain, formatted);
        saveCheckpoint(checkpointPath, checkpoint);
        processedThisRun += 1;
        lookupsSinceRotation += 1;

        const done = checkpoint.completedDomains.length;
        if (done === 1 || done === batchRows.length || done % 10 === 0) {
          const stats = summarizeResults(checkpoint.results);
          process.stderr.write(
            `[meta-ads-batch] ${done}/${batchRows.length} | yes ${stats.yes} | no ${stats.no} | unknown ${stats.unknown} | empty_no ${stats.emptyNoResult} | errors ${checkpoint.errors.length} | last: ${domain}\n`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordCheckpointError(checkpoint, { company_domain: domain, company_name: companyName, error: message });
        saveCheckpoint(checkpointPath, checkpoint);
        process.stderr.write(`Error on ${companyName}: ${message}\n`);
        processedThisRun += 1;
        lookupsSinceRotation += 1;
        consecutiveEmptyNoResults = 0;
      }
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
  const stats = summarizeResults(checkpoint.results);
  console.log(
    JSON.stringify(
      {
        output: outPath,
        checkpoint: checkpointPath,
        resumed: resume && !fresh,
        batch_mode: batchMode,
        pilot,
        total_rows: batchRows.length,
        completed_domains: checkpoint.completedDomains.length,
        stats,
        elapsed_ms: Date.now() - startedAt,
        errors: checkpoint.errors,
        results: checkpoint.results,
      },
      null,
      2,
    ),
  );
}

function summarizeResults(results: Record<string, unknown>[]): {
  yes: number;
  no: number;
  unknown: number;
  emptyNoResult: number;
} {
  return {
    yes: results.filter((r) => r.meta_ads_result === 'yes').length,
    no: results.filter((r) => r.meta_ads_result === 'no').length,
    unknown: results.filter((r) => r.meta_ads_result === 'unknown').length,
    emptyNoResult: results.filter((r) => r.empty_no_result === true).length,
  };
}

const BATCH_VIEWPORT = { width: 1440, height: 960 };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireBatchLock(outDir: string): void {
  const lockPath = resolve(outDir, '.batch.lock');
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
      throw new Error(
        `Another meta ads batch is already running (pid ${pid}). Stop it first or delete ${lockPath}`,
      );
    }
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, String(process.pid));
  const release = (): void => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

async function launchBatchBrowser(headless: boolean): Promise<{ browser: Browser; context: BrowserContext }> {
  const slowMoMs = headless ? 0 : pickSlowMoMs(40, 120);
  const browser = await chromium.launch({
    headless,
    ...(headless ? {} : { channel: 'chrome' as const }),
    slowMo: slowMoMs,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: BATCH_VIEWPORT,
    ignoreHTTPSErrors: true,
  });
  return { browser, context };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
