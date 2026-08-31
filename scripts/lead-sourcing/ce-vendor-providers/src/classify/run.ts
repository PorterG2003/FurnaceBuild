import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDirectoriesConfig } from '../lib/config.js';
import { loadEnv } from '../lib/env.js';
import { parseCliArgs, truncateRows } from '../lib/cli.js';
import { readCsv, writeCsv, rowToRecord, mergeDirectoryRows } from '../lib/csv.js';
import { fetchPage, hasCachedPage } from '../lib/http.js';
import { extractTitle } from '../lib/html.js';
import { HostGate, mapWithConcurrency } from '../lib/pool.js';
import { isFetchableUrl } from '../lib/url.js';
import { CLASSIFIED_COLUMNS, type ClassifiedEntry, type DirectoryEntry } from '../lib/types.js';
import { classifyFromHtml } from './heuristics.js';

export async function classifyEntries(options: {
  runDir?: string;
  fixtures?: boolean;
  maxRows?: number | null;
  directory?: string;
  concurrency?: number;
} = {}): Promise<{ runDir: string; rows: ClassifiedEntry[] }> {
  loadEnv();
  const cli = parseCliArgs();
  const config = loadDirectoriesConfig();
  const fixtures = options.fixtures ?? cli.fixtures ?? false;
  const directory = options.directory ?? cli.directory;
  const concurrency = options.concurrency ?? cli.concurrency;
  const runDir = resolve(options.runDir ?? cli.runDir ?? '');
  if (!runDir) throw new Error('--run-dir is required for classify');
  const inputPath = join(runDir, 'directory_entries.csv');
  if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}. Run directories first.`);

  let raw = readCsv(inputPath);
  if (directory) raw = raw.filter((row) => row.source_directory === directory);
  raw = truncateRows(raw, options.maxRows ?? cli.maxRows);
  const cacheDir = join(runDir, 'html-cache');
  const hostGate = fixtures ? undefined : new HostGate(config.fetch.rate_ms);

  const rows = await mapWithConcurrency(raw, fixtures ? raw.length || 1 : concurrency, async (rec, index) => {
    const entry = rec as unknown as DirectoryEntry;
    const homepageUrl = (entry.listed_website || '').trim();
    let html = '';
    let title = '';
    const skipLive =
      !fixtures && entry.source_directory === 'cope' && !hasCachedPage(cacheDir, homepageUrl);
    if (isFetchableUrl(homepageUrl) && !skipLive) {
      try {
        const page = await fetchPage({
          url: homepageUrl,
          useFixtures: fixtures,
          cacheDir,
          timeoutMs: config.fetch.timeout_ms,
          userAgent: config.fetch.user_agent,
          hostGate,
        });
        html = page.html;
        title = extractTitle(html);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[classify ${index + 1}/${raw.length}] fetch failed ${homepageUrl}: ${message}`);
      }
    }
    const classified = classifyFromHtml(entry.provider_name, html, title, {
      source_directory: entry.source_directory,
      page_url: homepageUrl,
    });
    console.error(`[classify ${index + 1}/${raw.length}] ${entry.provider_name} → ${classified.entity_class}`);
    const row: ClassifiedEntry = {
      ...entry,
      entity_class: classified.entity_class,
      company_sells_what: classified.company_sells_what,
      class_reason: classified.class_reason,
      homepage_url: homepageUrl,
      audience_relationship: classified.audience_relationship,
      has_formal_grant_program: classified.has_formal_grant_program,
    };
    return row;
  });

  mkdirSync(runDir, { recursive: true });
  const outPath = join(runDir, 'classified_entries.csv');
  const existing = existsSync(outPath) ? readCsv(outPath) : [];
  const merged = mergeDirectoryRows(existing, rows.map(rowToRecord), directory);
  writeCsv(outPath, merged, [...CLASSIFIED_COLUMNS]);
  writeFileSync(
    join(runDir, 'classified_coverage.json'),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        directory: directory ?? 'all',
        classified: rows.length,
        entity_class: countBy(rows, (r) => r.entity_class),
        audience_relationship: countBy(rows, (r) => r.audience_relationship),
      },
      null,
      2,
    )}\n`,
  );
  return { runDir, rows };
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row) || '(empty)';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
