import Papa from 'papaparse';
import type { CsvBuilderCellValue, CsvBuilderColumnDataType, PostCreateCsvBuilderRunBody } from '@/lib/foundry/registry-types';
import { buildCsvBuilderHeaders, type CsvBuilderNormalizedHeader } from './normalizeHeaders';

const UTF8_BOM = '\ufeff';
export const CSV_BUILDER_MAX_ROWS = 50000;
export const CSV_BUILDER_MAX_COLUMNS = 500;
export const CSV_BUILDER_MAX_BYTES = 25 * 1024 * 1024;
const DELIMITERS_TO_GUESS = [',', '\t', ';', '|'];

export interface ParsedCsvBuilderResult {
  originalHeaders: string[];
  displayHeaders: string[];
  normalizedHeaders: string[];
  rows: Array<Record<string, CsvBuilderCellValue>>;
  delimiter: string;
  warnings: string[];
  rowCount: number;
  columnCount: number;
  headers: PostCreateCsvBuilderRunBody['headers'];
}

type PapaRow = string[];

function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

function inferColumnDataType(values: CsvBuilderCellValue[]): CsvBuilderColumnDataType {
  const nonEmpty = values.filter((value) => !(value == null || value === ''));
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.every((value) => typeof value === 'string' && /^(true|false)$/i.test(value))) return 'boolean';
  if (nonEmpty.every((value) => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) return 'number';
  if (nonEmpty.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
  if (
    nonEmpty.every(
      (value) =>
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(value),
    )
  ) {
    return 'datetime';
  }
  return 'text';
}

function finalizeParsedRows(parsedRows: PapaRow[], delimiter: string): ParsedCsvBuilderResult {
  if (parsedRows.length === 0) {
    return {
      originalHeaders: [],
      displayHeaders: [],
      normalizedHeaders: [],
      rows: [],
      delimiter,
      warnings: [],
      rowCount: 0,
      columnCount: 0,
      headers: [],
    };
  }

  const rawHeaders = parsedRows[0] ?? [];
  if (rawHeaders.length === 0) {
    throw new Error('The CSV must include a header row.');
  }
  if (rawHeaders.length > CSV_BUILDER_MAX_COLUMNS) {
    throw new Error(`CSV Builder supports at most ${CSV_BUILDER_MAX_COLUMNS} columns in v1.`);
  }

  const { headers: baseHeaders, warnings } = buildCsvBuilderHeaders(rawHeaders);
  const headerMeta: CsvBuilderNormalizedHeader[] = [...baseHeaders];
  const rows = parsedRows.slice(1);
  if (rows.length > CSV_BUILDER_MAX_ROWS) {
    throw new Error(`CSV Builder supports at most ${CSV_BUILDER_MAX_ROWS} rows in v1.`);
  }

  const normalizedRows: Array<Record<string, CsvBuilderCellValue>> = rows.map((row, rowIndex) => {
    const values = [...row];
    if (values.length < headerMeta.length) {
      warnings.push(`Row ${rowIndex + 2} had fewer cells than the header row and was padded with empty values.`);
      while (values.length < headerMeta.length) values.push('');
    } else if (values.length > headerMeta.length) {
      warnings.push(`Row ${rowIndex + 2} had extra trailing cells and extra columns were added.`);
      for (let i = headerMeta.length; i < values.length && i < CSV_BUILDER_MAX_COLUMNS; i += 1) {
        headerMeta.push({
          key: `c${String(i + 1).padStart(3, '0')}`,
          originalHeader: '',
          displayHeader: `Column ${i + 1}`,
          normalizedHeader: `column ${i + 1}`,
        });
      }
    }
    const normalized: Record<string, CsvBuilderCellValue> = {};
    headerMeta.forEach((header, columnIndex) => {
      normalized[header.key] = values[columnIndex] ?? '';
    });
    return normalized;
  });

  const headers = headerMeta.map((header) => ({
    key: header.key,
    label: header.displayHeader,
    data_type: inferColumnDataType(normalizedRows.map((row) => row[header.key] ?? null)),
  }));

  return {
    originalHeaders: headerMeta.map((header) => header.originalHeader),
    displayHeaders: headers.map((header) => header.label),
    normalizedHeaders: headerMeta.map((header) => header.normalizedHeader),
    rows: normalizedRows,
    delimiter,
    warnings,
    rowCount: normalizedRows.length,
    columnCount: headers.length,
    headers,
  };
}

function parseRows(text: string): Promise<{ rows: PapaRow[]; delimiter: string }> {
  return new Promise((resolve, reject) => {
    Papa.parse<PapaRow>(stripBom(text), {
      delimiter: '',
      delimitersToGuess: DELIMITERS_TO_GUESS,
      skipEmptyLines: 'greedy',
      worker: false,
      complete: (result) => {
        if (Array.isArray(result.errors) && result.errors.length > 0) {
          const first = result.errors[0];
          reject(new Error(first?.message ? `Invalid CSV: ${first.message}` : 'Invalid CSV.'));
          return;
        }
        resolve({
          rows: (result.data as unknown as PapaRow[]) ?? [],
          delimiter: result.meta.delimiter || ',',
        });
      },
      error: (error: Error) => reject(error),
    });
  });
}

export async function parseCsvBuilderText(text: string): Promise<ParsedCsvBuilderResult> {
  const trimmed = stripBom(text).trim();
  if (!trimmed) {
    return {
      originalHeaders: [],
      displayHeaders: [],
      normalizedHeaders: [],
      rows: [],
      delimiter: ',',
      warnings: [],
      rowCount: 0,
      columnCount: 0,
      headers: [],
    };
  }
  const { rows, delimiter } = await parseRows(trimmed);
  return finalizeParsedRows(rows, delimiter);
}

export async function parseCsvBuilderFile(file: File): Promise<ParsedCsvBuilderResult> {
  if (file.size > CSV_BUILDER_MAX_BYTES) {
    throw new Error(`CSV Builder supports uploads up to ${Math.round(CSV_BUILDER_MAX_BYTES / (1024 * 1024))} MB in v1.`);
  }
  const text = await file.text();
  if (text.includes('\uFFFD')) {
    throw new Error('This file does not appear to be valid UTF-8. Please re-export it as UTF-8 CSV and try again.');
  }
  return parseCsvBuilderText(text);
}
