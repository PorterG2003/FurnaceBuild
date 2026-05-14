import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CsvBuilderCellValue,
  CsvBuilderColumnDataType,
  CsvBuilderColumnRow,
  CsvBuilderRunRow,
  CsvBuilderSourceHeaderInput,
  PostCreateCsvBuilderRunRowsBody,
} from '../../registry-types.js';

const INSERT_BATCH_SIZE = 500;

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function inferDataType(value: CsvBuilderCellValue): CsvBuilderColumnDataType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'json';
  if (value && typeof value === 'object') return 'json';
  return 'text';
}

function normalizeRowValues(
  row: Record<string, CsvBuilderCellValue>,
  columnKeys: string[],
): Record<string, CsvBuilderCellValue> {
  const out: Record<string, CsvBuilderCellValue> = {};
  for (const key of columnKeys) {
    const value = row[key];
    out[key] = value == null ? null : value;
  }
  return out;
}

type CsvBuilderPreparedHeader = {
  key: string;
  label: string;
  data_type: CsvBuilderColumnDataType;
  position: number;
};

type CsvBuilderCreateRunMetadata = {
  account_id: string;
  name: string;
  source_file_name: string;
  source_file_size_bytes?: number | null;
  source_file_mime_type?: string | null;
};

function prepareCsvBuilderHeaders(
  headersInput: CsvBuilderSourceHeaderInput[],
  rows: Array<Record<string, CsvBuilderCellValue>>,
): CsvBuilderPreparedHeader[] {
  if (!Array.isArray(headersInput) || headersInput.length === 0) throw new Error('headers are required');
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (rows.length > 50000) throw new Error('CSV Builder supports at most 50,000 rows in v1');
  if (headersInput.length > 500) throw new Error('CSV Builder supports at most 500 columns in v1');

  const headers = headersInput.map((header, index) => {
    const key = trimText(header.key) || `c${String(index + 1).padStart(3, '0')}`;
    const label = trimText(header.label) || `Column ${index + 1}`;
    const sampleValue = rows.find((row) => row && Object.prototype.hasOwnProperty.call(row, key))?.[key] ?? null;
    const dataType = header.data_type ?? inferDataType(sampleValue);
    return {
      key,
      label,
      data_type: dataType,
      position: index,
    };
  });

  const dedupedKeys = new Set<string>();
  for (const header of headers) {
    if (dedupedKeys.has(header.key)) throw new Error(`Duplicate header key: ${header.key}`);
    dedupedKeys.add(header.key);
  }

  return headers;
}

async function persistCsvBuilderRun(
  leadsClient: SupabaseClient,
  actorUserId: string,
  metadata: CsvBuilderCreateRunMetadata,
  headers: CsvBuilderPreparedHeader[],
  rows: Array<Record<string, CsvBuilderCellValue>>,
): Promise<{ run: CsvBuilderRunRow; columns: CsvBuilderColumnRow[] }> {
  const accountId = trimText(metadata.account_id);
  const name = trimText(metadata.name);
  const sourceFileName = trimText(metadata.source_file_name);
  if (!accountId) throw new Error('account_id is required');
  if (!name) throw new Error('name is required');
  if (!sourceFileName) throw new Error('source_file_name is required');

  const now = new Date().toISOString();
  const { data: insertedRun, error: runErr } = await leadsClient
    .from('csv_builder_runs')
    .insert({
      account_id: accountId,
      created_by: actorUserId,
      name,
      status: 'ready',
      source_file_name: sourceFileName,
      source_file_size_bytes: metadata.source_file_size_bytes ?? null,
      source_file_mime_type: metadata.source_file_mime_type ?? null,
      source_row_count: rows.length,
      source_column_count: headers.length,
      visible_column_count: headers.length,
      last_activity_at: now,
    })
    .select('*')
    .single();
  if (runErr || !insertedRun) throw new Error(runErr?.message ?? 'Failed to create CSV Builder run');

  const runId = String(insertedRun.id);
  const { data: insertedColumns, error: columnsErr } = await leadsClient
    .from('csv_builder_columns')
    .insert(
      headers.map((header) => ({
        run_id: runId,
        key: header.key,
        label: header.label,
        kind: 'source',
        data_type: header.data_type,
        position: header.position,
        visible: true,
        status: 'ready',
      })),
    )
    .select('*');
  if (columnsErr) throw new Error(columnsErr.message);

  const rowInserts = rows.map((row, index) => ({
    run_id: runId,
    row_number: index + 1,
    source_values: normalizeRowValues(row, headers.map((h) => h.key)),
    tool_values: {},
    row_status: 'ready',
  }));
  for (let i = 0; i < rowInserts.length; i += INSERT_BATCH_SIZE) {
    const batch = rowInserts.slice(i, i + INSERT_BATCH_SIZE);
    const { error: rowsErr } = await leadsClient.from('csv_builder_rows').insert(batch);
    if (rowsErr) throw new Error(rowsErr.message);
  }

  return {
    run: insertedRun as CsvBuilderRunRow,
    columns: (insertedColumns ?? []) as CsvBuilderColumnRow[],
  };
}

export async function listCsvBuilderRuns(
  leadsClient: SupabaseClient,
  accountId: string,
  params: { limit: number; offset: number },
): Promise<{ runs: CsvBuilderRunRow[]; limit: number; offset: number; total_count: number }> {
  const { data, error, count } = await leadsClient
    .from('csv_builder_runs')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .order('last_activity_at', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);
  if (error) throw new Error(error.message);
  return {
    runs: (data ?? []) as CsvBuilderRunRow[],
    limit: params.limit,
    offset: params.offset,
    total_count: count ?? 0,
  };
}

export async function getCsvBuilderRun(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<CsvBuilderRunRow | null> {
  const { data, error } = await leadsClient.from('csv_builder_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as CsvBuilderRunRow | null;
}

export async function createCsvBuilderRunFromRows(
  leadsClient: SupabaseClient,
  actorUserId: string,
  body: PostCreateCsvBuilderRunRowsBody & { account_id: string },
): Promise<{ run: CsvBuilderRunRow; columns: CsvBuilderColumnRow[] }> {
  const headers = prepareCsvBuilderHeaders(body.headers, body.rows);
  return persistCsvBuilderRun(leadsClient, actorUserId, body, headers, body.rows);
}

export async function createCsvBuilderRun(
  leadsClient: SupabaseClient,
  actorUserId: string,
  body: PostCreateCsvBuilderRunRowsBody & { account_id: string },
): Promise<{ run: CsvBuilderRunRow; columns: CsvBuilderColumnRow[] }> {
  return createCsvBuilderRunFromRows(leadsClient, actorUserId, body);
}
