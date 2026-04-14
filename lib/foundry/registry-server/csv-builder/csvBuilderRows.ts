import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CsvBuilderCellValue,
  CsvBuilderColumnRow,
  CsvBuilderFilter,
  CsvBuilderFilterOperator,
  CsvBuilderHydratedRow,
  CsvBuilderRowsResponse,
  CsvBuilderRowsQuery,
} from '../../registry-types.js';

const SCAN_BATCH_SIZE = 1000;

type RowRecord = {
  id: string;
  row_number: number;
  source_values: Record<string, CsvBuilderCellValue>;
  tool_values: Record<string, CsvBuilderCellValue>;
  row_status: string;
};

function valueForColumn(row: RowRecord, columnKey: string): CsvBuilderCellValue {
  if (Object.prototype.hasOwnProperty.call(row.tool_values ?? {}, columnKey)) {
    return row.tool_values[columnKey] ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(row.source_values ?? {}, columnKey)) {
    return row.source_values[columnKey] ?? null;
  }
  return null;
}

function hydrateRow(row: RowRecord, columnKeys: string[]): CsvBuilderHydratedRow {
  const values: Record<string, CsvBuilderCellValue> = {};
  for (const columnKey of columnKeys) {
    values[columnKey] = valueForColumn(row, columnKey);
  }
  return {
    id: row.id,
    row_number: row.row_number,
    row_status: row.row_status as CsvBuilderHydratedRow['row_status'],
    values,
  };
}

function normalizeString(value: CsvBuilderCellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function comparePrimitive(a: CsvBuilderCellValue, b: CsvBuilderCellValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return normalizeString(a).localeCompare(normalizeString(b), undefined, { sensitivity: 'base' });
}

function applyFilter(value: CsvBuilderCellValue, filter: CsvBuilderFilter, dataTypeByKey: Map<string, string>): boolean {
  const operator = filter.operator as CsvBuilderFilterOperator;
  const normalized = normalizeString(value);
  const dataType = dataTypeByKey.get(filter.column_key) ?? 'text';
  if (operator === 'empty') return value == null || normalized.trim() === '';
  if (operator === 'not_empty') return !(value == null || normalized.trim() === '');
  if (operator === 'contains') return normalized.toLowerCase().includes(String(filter.value ?? '').toLowerCase());
  if (operator === 'equals') return normalized.toLowerCase() === String(filter.value ?? '').toLowerCase();
  if (dataType === 'number' && ['gt', 'gte', 'lt', 'lte'].includes(operator)) {
    const left = typeof value === 'number' ? value : Number(normalized);
    const right = typeof filter.value === 'number' ? filter.value : Number(filter.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === 'gt') return left > right;
    if (operator === 'gte') return left >= right;
    if (operator === 'lt') return left < right;
    if (operator === 'lte') return left <= right;
  }
  if ((dataType === 'date' || dataType === 'datetime') && (operator === 'before' || operator === 'after')) {
    const left = Date.parse(normalized);
    const right = Date.parse(String(filter.value ?? ''));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return operator === 'before' ? left < right : left > right;
  }
  return true;
}

async function scanRowsForRun(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<RowRecord[]> {
  const rows: RowRecord[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await leadsClient
      .from('csv_builder_rows')
      .select('id, row_number, source_values, tool_values, row_status')
      .eq('run_id', runId)
      .order('row_number', { ascending: true })
      .range(offset, offset + SCAN_BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as RowRecord[];
    rows.push(...batch);
    if (batch.length < SCAN_BATCH_SIZE) break;
    offset += SCAN_BATCH_SIZE;
  }
  return rows;
}

export async function listCsvBuilderRows(
  leadsClient: SupabaseClient,
  runId: string,
  query: CsvBuilderRowsQuery,
): Promise<CsvBuilderRowsResponse> {
  const { data: columnsData, error: columnsErr } = await leadsClient
    .from('csv_builder_columns')
    .select('*')
    .eq('run_id', runId)
    .order('position', { ascending: true });
  if (columnsErr) throw new Error(columnsErr.message);
  const columns = (columnsData ?? []) as CsvBuilderColumnRow[];
  const visibleColumnKeys = columns.filter((column) => column.visible).map((column) => column.key);
  const requestedKeys =
    Array.isArray(query.columnKeys) && query.columnKeys.length > 0
      ? [...new Set(query.columnKeys.filter(Boolean))]
      : visibleColumnKeys;
  const dataTypeByKey = new Map(columns.map((column) => [column.key, column.data_type]));

  const noFilter = !Array.isArray(query.filters) || query.filters.length === 0;
  const noSort = !query.sortBy || query.sortBy === 'row_number';
  if (noFilter && noSort) {
    const offset = query.offset ?? 0;
    const requestedLimit = Math.max(1, query.limit);
    const rows: RowRecord[] = [];
    let totalCount = 0;
    let nextOffset = offset;
    let remaining = requestedLimit;

    while (remaining > 0) {
      const pageSize = Math.min(SCAN_BATCH_SIZE, remaining);
      const { data, error, count } = await leadsClient
        .from('csv_builder_rows')
        .select('id, row_number, source_values, tool_values, row_status', { count: rows.length === 0 ? 'exact' : undefined })
        .eq('run_id', runId)
        .order('row_number', { ascending: query.sortDirection !== 'desc' })
        .range(nextOffset, nextOffset + pageSize - 1);
      if (error) throw new Error(error.message);
      if (rows.length === 0) totalCount = count ?? 0;

      const batch = (data ?? []) as unknown as RowRecord[];
      rows.push(...batch);
      if (batch.length < pageSize) break;

      nextOffset += pageSize;
      remaining -= pageSize;
    }

    return {
      rows: rows.map((row) => hydrateRow(row, requestedKeys)),
      limit: requestedLimit,
      offset,
      total_count: totalCount,
      visible_column_keys: visibleColumnKeys,
    };
  }

  let rows = await scanRowsForRun(leadsClient, runId);
  if (Array.isArray(query.filters) && query.filters.length > 0) {
    rows = rows.filter((row) =>
      query.filters!.every((filter) => applyFilter(valueForColumn(row, filter.column_key), filter, dataTypeByKey)),
    );
  }
  const sortBy = query.sortBy?.trim();
  if (sortBy) {
    rows.sort((a, b) => {
      if (sortBy === 'row_number') {
        return (a.row_number - b.row_number) * (query.sortDirection === 'desc' ? -1 : 1);
      }
      return comparePrimitive(valueForColumn(a, sortBy), valueForColumn(b, sortBy)) * (query.sortDirection === 'desc' ? -1 : 1);
    });
  }
  const offset = query.offset ?? 0;
  const paged = rows.slice(offset, offset + query.limit);
  return {
    rows: paged.map((row) => hydrateRow(row, requestedKeys)),
    limit: query.limit,
    offset,
    total_count: rows.length,
    visible_column_keys: visibleColumnKeys,
  };
}
