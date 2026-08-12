import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsv } from '../lib/csv.ts';
import type { HubSpotClient } from '../lib/hubspotClient.ts';
import { cardToSearchRow } from '../lib/mapRows.ts';
import { sleepWithJitter } from '../lib/retry.ts';
import {
  DEFAULT_ACCREDITATION_NAME,
  PARTNER_SEARCH_COLUMNS,
  type PartnerSearchRow,
} from '../lib/types.ts';

export type SearchCheckpoint = {
  offset: number;
  total: number | null;
  accreditationId: number;
  done: boolean;
};

function checkpointPath(runDir: string): string {
  return join(runDir, 'search_checkpoint.json');
}

export function loadSearchCheckpoint(runDir: string): SearchCheckpoint | null {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SearchCheckpoint;
}

function saveSearchCheckpoint(runDir: string, checkpoint: SearchCheckpoint): void {
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

export async function runStage1Search(options: {
  runDir: string;
  client: HubSpotClient;
  accreditationId: number;
  accreditationName?: string;
  pageSize: number;
  rateMs: number;
  maxRows: number | null;
  resume: boolean;
  dryRun: boolean;
}): Promise<{ rows: PartnerSearchRow[]; total: number; callsMade: number }> {
  const {
    runDir,
    client,
    accreditationId,
    pageSize,
    rateMs,
    maxRows,
    resume,
    dryRun,
  } = options;
  const accreditationName = options.accreditationName ?? DEFAULT_ACCREDITATION_NAME;
  mkdirSync(runDir, { recursive: true });

  const partnersPath = join(runDir, 'partners.csv');
  const existing =
    resume && existsSync(partnersPath)
      ? (await import('../lib/csv.ts')).readCsv(partnersPath).map((r) => r as PartnerSearchRow)
      : [];

  const seen = new Set(existing.map((r) => r.listing_id).filter(Boolean));
  const rows: PartnerSearchRow[] = [...existing];

  let checkpoint =
    resume && loadSearchCheckpoint(runDir)
      ? loadSearchCheckpoint(runDir)!
      : { offset: 0, total: null as number | null, accreditationId, done: false };

  if (checkpoint.done && maxRows == null) {
    console.log(`[stage1] checkpoint done; ${rows.length} partners already scraped`);
    return { rows, total: checkpoint.total ?? rows.length, callsMade: 0 };
  }

  if (dryRun) {
    const preview = await client.searchPartners(0, Math.min(pageSize, maxRows ?? pageSize));
    console.log(
      `[stage1] dry-run: API total=${preview.total}, would fetch up to ${maxRows ?? preview.total}`,
    );
    return { rows, total: preview.total, callsMade: client.counter.search };
  }

  const scrapedAt = new Date().toISOString();
  let total = checkpoint.total ?? 0;
  let offset = checkpoint.offset;

  while (true) {
    if (maxRows != null && rows.length >= maxRows) break;
    if (checkpoint.done) break;

    const length =
      maxRows != null ? Math.min(pageSize, maxRows - rows.length) : pageSize;
    if (length <= 0) break;

    const page = await client.searchPartners(offset, length);
    total = page.total;
    checkpoint.total = total;

    if (page.cards.length === 0) {
      checkpoint.done = true;
      saveSearchCheckpoint(runDir, checkpoint);
      break;
    }

    for (const card of page.cards) {
      if (maxRows != null && rows.length >= maxRows) break;
      const row = cardToSearchRow(card, {
        accreditationId,
        accreditationName,
        scrapedAt,
      });
      if (!row.listing_id || seen.has(row.listing_id)) continue;
      seen.add(row.listing_id);
      rows.push(row);
    }

    offset += page.cards.length;
    checkpoint.offset = offset;

    const reachedEnd = offset >= total || page.cards.length < length;
    const hitMax = maxRows != null && rows.length >= maxRows;
    if (reachedEnd || hitMax) {
      checkpoint.done = maxRows == null ? reachedEnd : hitMax && rows.length >= (maxRows ?? 0);
      // When maxRows caps early, mark done for this run's search phase
      if (hitMax) checkpoint.done = true;
      if (reachedEnd) checkpoint.done = true;
    }

    writeCsv(
      partnersPath,
      rows as unknown as Record<string, string>[],
      PARTNER_SEARCH_COLUMNS as string[],
    );
    saveSearchCheckpoint(runDir, checkpoint);
    console.log(
      `[stage1] offset=${offset}/${total} rows=${rows.length} search_calls=${client.counter.search}`,
    );

    if (checkpoint.done) break;
    await sleepWithJitter(rateMs);
  }

  writeCsv(
    partnersPath,
    rows as unknown as Record<string, string>[],
    PARTNER_SEARCH_COLUMNS as string[],
  );
  saveSearchCheckpoint(runDir, { ...checkpoint, done: true });
  return { rows, total, callsMade: client.counter.search };
}
