import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getCsvBuilderRun } from '../../../lib/foundry/registry-server/csv-builder/csvBuilderRuns.js';
import { listCsvBuilderColumns } from '../../../lib/foundry/registry-server/csv-builder/csvBuilderColumns.js';
import { listCsvBuilderRows } from '../../../lib/foundry/registry-server/csv-builder/csvBuilderRows.js';

let cachedClient: SupabaseClient | null = null;
const s3Client = new S3Client({});

function getLeadsClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.LEADS_SUPABASE_URL;
  const key = process.env.LEADS_SUPABASE_SECRET_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

type RunEvent = { jobId: string; runId: string };
type FailEvent = { action: 'fail'; jobId: string; message?: string };

function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const stringValue =
    typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  if (/["\n,\r]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

export const handler = async (event: RunEvent | FailEvent): Promise<Record<string, unknown>> => {
  const client = getLeadsClient();
  if ('action' in event && event.action === 'fail') {
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: event.message ?? 'Step Functions failure',
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  const bucket = process.env.CSV_BUILDER_EXPORT_BUCKET?.trim();
  if (!bucket) throw new Error('Missing CSV_BUILDER_EXPORT_BUCKET');
  const runEvent = event as RunEvent;

  const { data: job } = await client.from('foundry_jobs').select('payload, progress').eq('id', event.jobId).maybeSingle();
  const payload = (job?.payload ?? {}) as Record<string, unknown>;
  const progress = (job?.progress ?? {}) as Record<string, unknown>;
  const requestedColumnKeys = Array.isArray(payload.column_keys) ? payload.column_keys.map((value) => String(value)) : [];
  const sortBy = typeof payload.sort_by === 'string' && payload.sort_by.trim() ? payload.sort_by : undefined;
  const sortDirection = payload.sort_direction === 'asc' ? 'asc' : 'desc';
  const filters = Array.isArray(payload.filters) ? payload.filters : [];

  const run = await getCsvBuilderRun(client as unknown as Parameters<typeof getCsvBuilderRun>[0], runEvent.runId);
  if (!run) throw new Error('CSV Builder run not found');
  const columns = await listCsvBuilderColumns(
    client as unknown as Parameters<typeof listCsvBuilderColumns>[0],
    runEvent.runId,
  );
  const visibleColumns = columns.filter((column) => column.visible);
  const columnKeys = requestedColumnKeys.length > 0 ? requestedColumnKeys : visibleColumns.map((column) => column.key);
  const rowsResult = await listCsvBuilderRows(client as unknown as Parameters<typeof listCsvBuilderRows>[0], runEvent.runId, {
    limit: Math.max(1, run.source_row_count || 50000),
    offset: 0,
    columnKeys,
    sortBy,
    sortDirection,
    filters: filters as never,
  });

  const exportColumns = visibleColumns.filter((column) => columnKeys.includes(column.key));
  const lines: string[] = [
    exportColumns.map((column) => escapeCsvCell(column.label)).join(','),
    ...rowsResult.rows.map((row) => exportColumns.map((column) => escapeCsvCell(row.values[column.key])).join(',')),
  ];
  const csv = `${lines.join('\n')}\n`;
  const objectKey = `csv-builder-exports/${runEvent.runId}/${event.jobId}.csv`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: csv,
      ContentType: 'text/csv; charset=utf-8',
    }),
  );
  const downloadUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentType: 'text/csv; charset=utf-8',
      ResponseContentDisposition: `attachment; filename="${run.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'csv_builder_export'}.csv"`,
    }),
    { expiresIn: 60 * 15 },
  );

  await client
    .from('foundry_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payload: {
        ...payload,
        object_key: objectKey,
      },
      progress: {
        ...progress,
        current_step: 'done',
        rows_processed: rowsResult.total_count,
        total_rows: rowsResult.total_count,
        download_url: downloadUrl,
      },
    })
    .eq('id', event.jobId);

  await client
    .from('csv_builder_runs')
    .update({
      last_exported_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', runEvent.runId);

  return { ok: true, objectKey };
};
