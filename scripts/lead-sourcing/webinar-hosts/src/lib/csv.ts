import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function readCsv(path: string): Record<string, string>[] {
  const raw = readFileSync(path, 'utf8');
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

export function writeCsv(path: string, rows: Record<string, string>[], columns: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export function writeCsvFromObjects(path: string, rows: Record<string, string>[]): void {
  if (rows.length === 0) {
    writeFileSync(path, '\n', 'utf8');
    return;
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  writeCsv(path, rows, columns);
}
