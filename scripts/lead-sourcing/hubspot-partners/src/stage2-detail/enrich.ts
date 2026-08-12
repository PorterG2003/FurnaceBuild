import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, writeCsv } from '../lib/csv.ts';
import type { HubSpotClient } from '../lib/hubspotClient.ts';
import { mergeDetail } from '../lib/mapRows.ts';
import { sleepWithJitter } from '../lib/retry.ts';
import {
  PARTNER_ENRICHED_COLUMNS,
  type LabelMaps,
  type PartnerEnrichedRow,
  type PartnerSearchRow,
} from '../lib/types.ts';

export type DetailCheckpoint = {
  completedSlugs: string[];
  failedSlugs: string[];
};

function checkpointPath(runDir: string): string {
  return join(runDir, 'detail_checkpoint.json');
}

export function loadDetailCheckpoint(runDir: string): DetailCheckpoint {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) return { completedSlugs: [], failedSlugs: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as DetailCheckpoint;
}

function saveDetailCheckpoint(runDir: string, checkpoint: DetailCheckpoint): void {
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function appendError(runDir: string, entry: Record<string, unknown>): void {
  appendFileSync(join(runDir, 'detail_errors.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function runStage2Detail(options: {
  runDir: string;
  client: HubSpotClient;
  rateMs: number;
  resume: boolean;
  dryRun: boolean;
  labels?: LabelMaps;
}): Promise<{ rows: PartnerEnrichedRow[]; detailCalls: number }> {
  const { runDir, client, rateMs, resume, dryRun } = options;
  mkdirSync(runDir, { recursive: true });

  const partnersPath = join(runDir, 'partners.csv');
  if (!existsSync(partnersPath)) {
    throw new Error(`Missing ${partnersPath}; run stage1 first`);
  }

  const searchRows = readCsv(partnersPath) as unknown as PartnerSearchRow[];
  const enrichedPath = join(runDir, 'partners_enriched.csv');

  const existing =
    resume && existsSync(enrichedPath)
      ? (readCsv(enrichedPath) as unknown as PartnerEnrichedRow[])
      : [];
  const byListing = new Map(existing.map((r) => [r.listing_id, r]));

  const checkpoint = resume
    ? loadDetailCheckpoint(runDir)
    : { completedSlugs: [] as string[], failedSlugs: [] as string[] };
  const completed = new Set(checkpoint.completedSlugs);
  const failed = new Set(checkpoint.failedSlugs);

  if (dryRun) {
    const pending = searchRows.filter((r) => r.slug && !completed.has(r.slug));
    console.log(`[stage2] dry-run: would enrich ${pending.length} partners`);
    return { rows: existing, detailCalls: 0 };
  }

  const pending = searchRows.filter((r) => r.slug && !completed.has(r.slug));
  if (pending.length === 0) {
    console.log(`[stage2] all ${searchRows.length} partners already enriched; skipping`);
    const rows =
      existing.length > 0
        ? existing
        : (readCsv(enrichedPath) as unknown as PartnerEnrichedRow[]);
    return { rows, detailCalls: 0 };
  }

  const labelsPath = join(runDir, 'label_maps.json');
  let labels = options.labels;
  if (!labels && existsSync(labelsPath)) {
    labels = JSON.parse(readFileSync(labelsPath, 'utf8')) as LabelMaps;
  }
  if (!labels) {
    labels = await client.getLabelMaps();
    writeFileSync(labelsPath, `${JSON.stringify(labels, null, 2)}\n`, 'utf8');
  }

  const startDetailCalls = client.counter.detail;
  let processed = 0;

  for (const searchRow of searchRows) {
    const slug = searchRow.slug;
    if (!slug) continue;
    if (completed.has(slug)) continue;

    try {
      const detail = await client.getListingDetails(slug);
      const enriched = mergeDetail(searchRow, detail, labels, {
        detail_status: 'ok',
        detail_error: '',
      });
      byListing.set(searchRow.listing_id, enriched);
      completed.add(slug);
      failed.delete(slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendError(runDir, {
        slug,
        listing_id: searchRow.listing_id,
        at: new Date().toISOString(),
        error: message,
      });
      const enriched = mergeDetail(searchRow, null, labels, {
        detail_status: 'error',
        detail_error: message,
      });
      byListing.set(searchRow.listing_id, enriched);
      failed.add(slug);
      console.warn(`[stage2] detail failed for ${slug}: ${message}`);
    }

    checkpoint.completedSlugs = [...completed];
    checkpoint.failedSlugs = [...failed];
    saveDetailCheckpoint(runDir, checkpoint);

    const rows = searchRows
      .map((r) => byListing.get(r.listing_id))
      .filter((r): r is PartnerEnrichedRow => Boolean(r));
    writeCsv(
      enrichedPath,
      rows as unknown as Record<string, string>[],
      PARTNER_ENRICHED_COLUMNS as string[],
    );

    processed += 1;
    if (processed % 10 === 0 || processed === searchRows.length) {
      console.log(
        `[stage2] enriched ${completed.size}/${searchRows.length} (failed=${failed.size}) detail_calls=${client.counter.detail}`,
      );
    }

    await sleepWithJitter(rateMs);
  }

  // Ensure every search row is present in enriched output
  const finalRows = searchRows.map((r) => {
    const existingRow = byListing.get(r.listing_id);
    if (existingRow) return existingRow;
    return mergeDetail(r, null, labels, {
      detail_status: 'missing',
      detail_error: 'not enriched',
    });
  });
  writeCsv(
    enrichedPath,
    finalRows as unknown as Record<string, string>[],
    PARTNER_ENRICHED_COLUMNS as string[],
  );

  return {
    rows: finalRows,
    detailCalls: client.counter.detail - startDetailCalls,
  };
}
