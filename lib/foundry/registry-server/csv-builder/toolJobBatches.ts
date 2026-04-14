import type { SupabaseClient } from '@supabase/supabase-js';

export const CSV_BUILDER_TOOL_BATCH_SIZE_DEFAULT = 25;
export const CSV_BUILDER_TOOL_BATCH_SIZE_MIN = 10;
export const CSV_BUILDER_TOOL_BATCH_SIZE_MAX = 50;
export const CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_DEFAULT = 4;
export const CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_MIN = 1;
export const CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_MAX = 10;

type CsvBuilderRowIdRecord = {
  id: string;
};

export interface CsvBuilderToolJobBatchRow {
  id: string;
  tool_job_id: string;
  foundry_job_id: string | null;
  batch_index: number;
  row_ids: string[];
  row_count: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
}

export function csvBuilderToolBatchSize(): number {
  return Math.min(
    CSV_BUILDER_TOOL_BATCH_SIZE_MAX,
    Math.max(CSV_BUILDER_TOOL_BATCH_SIZE_MIN, CSV_BUILDER_TOOL_BATCH_SIZE_DEFAULT),
  );
}

export function csvBuilderToolMapMaxConcurrency(): number {
  return Math.min(
    CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_MAX,
    Math.max(CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_MIN, CSV_BUILDER_TOOL_MAP_MAX_CONCURRENCY_DEFAULT),
  );
}

function chunkRowIds(rowIds: string[], batchSize: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < rowIds.length; i += batchSize) {
    out.push(rowIds.slice(i, i + batchSize));
  }
  return out;
}

async function listCsvBuilderRowIdsForRun(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<string[]> {
  const rowIds: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await leadsClient
      .from('csv_builder_rows')
      .select('id')
      .eq('run_id', runId)
      .order('row_number', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CsvBuilderRowIdRecord[];
    rowIds.push(...batch.map((row) => String(row.id)));
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return rowIds;
}

export async function resetCsvBuilderToolJobExecutionArtifacts(
  leadsClient: SupabaseClient,
  toolJobId: string,
): Promise<void> {
  const { error: resultsErr } = await leadsClient
    .from('csv_builder_tool_job_row_results')
    .delete()
    .eq('tool_job_id', toolJobId);
  if (resultsErr) throw new Error(resultsErr.message);
  const { error: batchesErr } = await leadsClient
    .from('csv_builder_tool_job_batches')
    .delete()
    .eq('tool_job_id', toolJobId);
  if (batchesErr) throw new Error(batchesErr.message);
}

export async function planCsvBuilderToolJobBatches(
  leadsClient: SupabaseClient,
  args: {
    toolJobId: string;
    foundryJobId: string;
    runId: string;
    batchSize?: number;
  },
): Promise<{
  batchIds: string[];
  batchSize: number;
  batchCount: number;
  rowCount: number;
  maxConcurrency: number;
}> {
  const desiredBatchSize = Math.min(
    CSV_BUILDER_TOOL_BATCH_SIZE_MAX,
    Math.max(CSV_BUILDER_TOOL_BATCH_SIZE_MIN, Math.trunc(args.batchSize ?? csvBuilderToolBatchSize())),
  );
  const rowIds = await listCsvBuilderRowIdsForRun(leadsClient, args.runId);
  const rowBatches = chunkRowIds(rowIds, desiredBatchSize);
  if (rowBatches.length === 0) {
    return {
      batchIds: [],
      batchSize: desiredBatchSize,
      batchCount: 0,
      rowCount: 0,
      maxConcurrency: csvBuilderToolMapMaxConcurrency(),
    };
  }
  const { data, error } = await leadsClient
    .from('csv_builder_tool_job_batches')
    .insert(
      rowBatches.map((rowBatch, batchIndex) => ({
        tool_job_id: args.toolJobId,
        foundry_job_id: args.foundryJobId,
        batch_index: batchIndex,
        row_ids: rowBatch,
        row_count: rowBatch.length,
        status: 'queued',
        attempt_count: 0,
      })),
    )
    .select('*');
  if (error || !data) throw new Error(error?.message ?? 'Failed to create CSV Builder tool job batches');
  const batchRows = (data as CsvBuilderToolJobBatchRow[]).sort((a, b) => a.batch_index - b.batch_index);
  return {
    batchIds: batchRows.map((batch) => batch.id),
    batchSize: desiredBatchSize,
    batchCount: batchRows.length,
    rowCount: rowIds.length,
    maxConcurrency: csvBuilderToolMapMaxConcurrency(),
  };
}
