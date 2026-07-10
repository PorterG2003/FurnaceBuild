import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { runMetaAdLibraryLookup } from './metaAdLibraryLookup.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/stage1-live/stage3_webinar_host_entities.csv';

type CsvRow = Record<string, string>;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function loadCsv(path: string): CsvRow[] {
  const raw = readFileSync(path, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

function pickSample(rows: CsvRow[], names: string[]): CsvRow[] {
  const byName = new Map(rows.map((r) => [r.company_name, r]));
  return names.map((name) => byName.get(name)).filter((r): r is CsvRow => Boolean(r));
}

const SAMPLE_NAMES = [
  'Supermetrics',
  'Xtalks',
  'Commvault',
  'GWC Data.AI',
  'Instinct Science',
  'Behavioral Health Business',
  'CurvUp',
  'Henry Smith Foundation',
];

const DEFAULT_SAMPLE_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch';
const DEFAULT_FULL_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch-full';
const DEFAULT_INTER_COMPANY_DELAY_MS = 2000;

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eligibleRows(rows: CsvRow[]): CsvRow[] {
  return rows.filter((r) => r.enrichment_status === 'ok' && r.company_domain?.trim());
}

function pickRows(rows: CsvRow[], batchMode: 'sample' | 'all', maxRows: number | null): CsvRow[] {
  const base = batchMode === 'all' ? eligibleRows(rows) : pickSample(rows, SAMPLE_NAMES);
  if (maxRows != null && maxRows > 0) return base.slice(0, maxRows);
  return base;
}

function formatBatchResult(
  row: CsvRow,
  result: Awaited<ReturnType<typeof runMetaAdLibraryLookup>>,
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
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  const headless = hasFlag(argv, '--headless');
  const scanWebinars = hasFlag(argv, '--scan-webinars');
  const resume = hasFlag(argv, '--resume');
  const fresh = hasFlag(argv, '--fresh');
  const batchAll = hasFlag(argv, '--all');
  const webinarDaysFlag = argv.indexOf('--webinar-days');
  const webinarScanDays =
    webinarDaysFlag >= 0 ? Number(argv[webinarDaysFlag + 1] ?? 30) : 30;
  const maxRowsFlag = readFlag(argv, '--max-rows');
  const maxRows = maxRowsFlag ? Number(maxRowsFlag) : null;
  const delayMs = Number(readFlag(argv, '--delay-ms') ?? DEFAULT_INTER_COMPANY_DELAY_MS);
  const csvPath = resolve(__dirname, positional[0] ?? DEFAULT_CSV);
  const batchMode = batchAll ? 'all' : 'sample';

  const rows = loadCsv(csvPath);
  const batchRows = pickRows(rows, batchMode, maxRows);
  if (batchRows.length === 0) throw new Error('No rows to process');

  const defaultOutDir = batchMode === 'all' ? DEFAULT_FULL_OUT_DIR : DEFAULT_SAMPLE_OUT_DIR;
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

  process.stderr.write(
    [
      '[meta-ads-batch] starting',
      `  mode: ${batchMode}`,
      `  rows: ${batchRows.length}`,
      `  headed: ${!headless}`,
      `  scan_webinars: ${scanWebinars}`,
      `  delay_ms: ${delayMs}`,
      `  out_dir: ${outDir}`,
      `  checkpoint: ${checkpointPath}`,
    ].join('\n') + '\n',
  );

  acquireBatchLock(outDir);
  const { browser, context } = await launchBatchBrowser(headless);

  try {
    for (const row of batchRows) {
      const domain = row.company_domain.trim();
      const companyName = row.company_name.trim();
      if (completed.has(domain)) {
        process.stderr.write(`Skipping ${companyName} (${domain}) — already in checkpoint\n`);
        continue;
      }

      if (processedThisRun > 0 && delayMs > 0) {
        await sleep(delayMs);
      }

      process.stderr.write(`Looking up ${companyName} (${domain})...\n`);
      try {
        const result = await runMetaAdLibraryLookup({
          domain,
          companyName,
          headless,
          timeoutMs: 45_000,
          outputDir: outDir,
          scanWebinars,
          webinarScanDays,
          browser,
          context,
        });
        const formatted = formatBatchResult(row, result);
        markCheckpointCompleted(checkpoint, domain, formatted);
        saveCheckpoint(checkpointPath, checkpoint);
        processedThisRun += 1;
        const done = checkpoint.completedDomains.length;
        if (done === 1 || done === batchRows.length || done % 25 === 0) {
          const stats = summarizeResults(checkpoint.results);
          process.stderr.write(
            `[meta-ads-batch] ${done}/${batchRows.length} | yes ${stats.yes} | no ${stats.no} | unknown ${stats.unknown} | errors ${checkpoint.errors.length} | last: ${domain}\n`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordCheckpointError(checkpoint, { company_domain: domain, company_name: companyName, error: message });
        saveCheckpoint(checkpointPath, checkpoint);
        process.stderr.write(`Error on ${companyName}: ${message}\n`);
        processedThisRun += 1;
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
} {
  return {
    yes: results.filter((r) => r.meta_ads_result === 'yes').length,
    no: results.filter((r) => r.meta_ads_result === 'no').length,
    unknown: results.filter((r) => r.meta_ads_result === 'unknown').length,
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
  const browser = await chromium.launch({
    headless,
    ...(headless ? {} : { channel: 'chrome' as const }),
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
