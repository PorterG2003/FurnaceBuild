/**
 * Backfill city/state/country onto an existing stage4 leads CSV via Apollo people/match.
 * Does not reveal emails (location-only match).
 *
 * Usage:
 *   npm run backfill-locations -- \
 *     --input output/runs/2026-07-08-linkedin-webinar-posts/stage4_webinar_host_leads.csv
 *
 * Resume:
 *   npm run backfill-locations -- --resume \
 *     --input output/runs/2026-07-08-linkedin-webinar-posts/stage4_webinar_host_leads.csv
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv, useFixtures } from '../lib/env.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { parseCliArgs } from '../lib/cli.js';
import { STAGE4_LEAD_COLUMNS, rowToRecord, type Stage4LeadRow } from '../lib/types.js';
import { CallCounter } from '../lib/callCounter.js';
import { sleepWithJitter } from '../lib/retry.js';
import {
  extractPersonLocation,
  matchPersonForLocation,
  type ApolloClientOptions,
} from '../stage3-enrich/apolloClient.js';

export const LOCATION_CHECKPOINT_FILE = 'stage4_location_backfill_checkpoint.json';

export type LocationBackfillStats = {
  rows: number;
  processed: number;
  matched: number;
  with_country: number;
  with_city: number;
  skipped_already_filled: number;
  skipped_no_key: number;
  errors: number;
};

type LocationCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  input_path: string;
  output_path: string;
  next_index: number;
  stats: LocationBackfillStats;
  updated_at: string;
};

export type BackfillLocationsOptions = {
  inputPath: string;
  outputPath?: string;
  resume?: boolean;
  dryRun?: boolean;
  maxRows?: number | null;
  apolloOptions?: ApolloClientOptions;
  counter?: CallCounter;
  persistEvery?: number;
  delayMs?: number;
};

function emptyStats(rows: number): LocationBackfillStats {
  return {
    rows,
    processed: 0,
    matched: 0,
    with_country: 0,
    with_city: 0,
    skipped_already_filled: 0,
    skipped_no_key: 0,
    errors: 0,
  };
}

function checkpointPathFor(outputPath: string): string {
  return resolve(dirname(outputPath), LOCATION_CHECKPOINT_FILE);
}

function normalizeLead(row: Record<string, string>): Stage4LeadRow {
  return rowToRecord({
    email: row.email ?? '',
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    company_name: row.company_name ?? '',
    website: row.website ?? '',
    linkedin_url: row.linkedin_url ?? '',
    company_linkedin_url: row.company_linkedin_url ?? '',
    webinar_topic: row.webinar_topic ?? '',
    registration_url: row.registration_url ?? '',
    sample_post_url: row.sample_post_url ?? '',
    contact_title: row.contact_title ?? '',
    contact_tier: row.contact_tier ?? '',
    contact_pick_reason: row.contact_pick_reason ?? '',
    employee_count: row.employee_count ?? '',
    industry: row.industry ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    country: row.country ?? '',
  }) as Stage4LeadRow;
}

function hasCountry(row: Stage4LeadRow): boolean {
  return Boolean(row.country?.trim());
}

function loadCheckpoint(path: string): LocationCheckpoint | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as LocationCheckpoint;
}

function saveCheckpoint(path: string, checkpoint: LocationCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function persistLeads(outputPath: string, leads: Stage4LeadRow[]): void {
  writeCsv(outputPath, leads, [...STAGE4_LEAD_COLUMNS]);
}

export async function backfillLocations(
  options: BackfillLocationsOptions,
): Promise<{ outputPath: string; stats: LocationBackfillStats }> {
  const inputPath = resolve(options.inputPath);
  const outputPath = resolve(options.outputPath ?? inputPath);
  const checkpointPath = checkpointPathFor(outputPath);
  const persistEvery = options.persistEvery ?? 25;
  const delayMs = options.delayMs ?? 250;

  let leads = readCsv(inputPath).map(normalizeLead);
  if (options.maxRows != null && options.maxRows > 0) {
    leads = leads.slice(0, options.maxRows);
  }

  let startIndex = 0;
  let stats = emptyStats(leads.length);
  const resume = Boolean(options.resume);

  if (resume) {
    const existing = loadCheckpoint(checkpointPath);
    if (!existing) {
      throw new Error(`No location backfill checkpoint at ${checkpointPath}`);
    }
    if (resolve(existing.input_path) !== inputPath || resolve(existing.output_path) !== outputPath) {
      throw new Error(
        `Checkpoint paths do not match. checkpoint input=${existing.input_path} output=${existing.output_path}`,
      );
    }
    if (existsSync(outputPath)) {
      leads = readCsv(outputPath).map(normalizeLead);
      if (options.maxRows != null && options.maxRows > 0) {
        leads = leads.slice(0, options.maxRows);
      }
    }
    startIndex = existing.next_index;
    stats = { ...existing.stats, rows: leads.length };
    console.error(
      `[backfill-locations] resume from index ${startIndex}/${leads.length} (${stats.with_country} with country)`,
    );
  } else if (existsSync(checkpointPath)) {
    const existing = loadCheckpoint(checkpointPath);
    if (existing?.status === 'in_progress') {
      throw new Error(
        `In-progress checkpoint exists at ${checkpointPath}. Pass --resume to continue, or delete it to start fresh.`,
      );
    }
  }

  if (options.dryRun) {
    const needLookup = leads.filter((row) => !hasCountry(row)).length;
    const already = leads.length - needLookup;
    console.log(
      JSON.stringify({
        dry_run: true,
        rows: leads.length,
        already_with_country: already,
        need_apollo_match: needLookup,
        estimate_apollo_calls: needLookup,
        output: outputPath,
      }),
    );
    return { outputPath, stats: { ...stats, skipped_already_filled: already } };
  }

  const apolloOptions: ApolloClientOptions = {
    ...options.apolloOptions,
    useFixtures: options.apolloOptions?.useFixtures ?? useFixtures(),
    counter: options.counter ?? options.apolloOptions?.counter ?? new CallCounter(),
  };

  const checkpoint: LocationCheckpoint = {
    version: 1,
    status: 'in_progress',
    input_path: inputPath,
    output_path: outputPath,
    next_index: startIndex,
    stats,
    updated_at: new Date().toISOString(),
  };

  console.error(
    `[backfill-locations] ── starting ──\n` +
      `  input: ${inputPath}\n` +
      `  output: ${outputPath}\n` +
      `  rows: ${leads.length} (from ${startIndex + 1})\n` +
      `  checkpoint: ${checkpointPath}`,
  );

  for (let i = startIndex; i < leads.length; i++) {
    const row = leads[i]!;
    stats.processed += 1;

    if (hasCountry(row)) {
      stats.skipped_already_filled += 1;
      if (row.city?.trim()) stats.with_city += 1;
      stats.with_country += 1;
    } else {
      const linkedinUrl = row.linkedin_url?.trim();
      const email = row.email?.trim();
      if (!linkedinUrl && !email) {
        stats.skipped_no_key += 1;
      } else {
        try {
          const person = await matchPersonForLocation({ linkedinUrl, email }, apolloOptions);
          if (person) {
            stats.matched += 1;
            const location = extractPersonLocation(person);
            row.city = location.city;
            row.state = location.state;
            row.country = location.country;
            if (location.city) stats.with_city += 1;
            if (location.country) stats.with_country += 1;
          }
          await sleepWithJitter(delayMs, 150);
        } catch (error) {
          stats.errors += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[backfill-locations] error row ${i + 1} ${row.email}: ${message}`);
          await sleepWithJitter(delayMs * 2, 200);
        }
      }
    }

    checkpoint.next_index = i + 1;
    checkpoint.stats = { ...stats };
    checkpoint.updated_at = new Date().toISOString();

    const isLast = i === leads.length - 1;
    const shouldPersist = isLast || (i + 1) % persistEvery === 0 || i === startIndex;
    if (shouldPersist) {
      persistLeads(outputPath, leads);
      saveCheckpoint(checkpointPath, checkpoint);
      console.error(
        `[backfill-locations] ${i + 1}/${leads.length} | country ${stats.with_country} | ` +
          `matched ${stats.matched} | errors ${stats.errors} | last: ${row.company_name}`,
      );
    }
  }

  checkpoint.status = 'completed';
  checkpoint.stats = { ...stats };
  checkpoint.updated_at = new Date().toISOString();
  persistLeads(outputPath, leads);
  saveCheckpoint(checkpointPath, checkpoint);

  console.error(
    `[backfill-locations] ── complete ──\n` +
      `  country: ${stats.with_country}/${stats.rows}\n` +
      `  city: ${stats.with_city}\n` +
      `  matched: ${stats.matched}\n` +
      `  errors: ${stats.errors}\n` +
      `  output: ${outputPath}`,
  );
  console.log(JSON.stringify({ stage: 'backfill-locations', ...stats, output: outputPath }));

  return { outputPath, stats };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  if (!cli.input) {
    throw new Error(
      'Usage: npm run backfill-locations -- --input path/to/stage4_webinar_host_leads.csv [--output ...] [--resume] [--dry-run]',
    );
  }
  await ensureEnv();
  await backfillLocations({
    inputPath: cli.input,
    outputPath: cli.output,
    resume: Boolean(cli.resume),
    dryRun: cli.dryRun,
    maxRows: cli.maxRows,
    apolloOptions: { useFixtures: cli.fixtures || useFixtures() },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
