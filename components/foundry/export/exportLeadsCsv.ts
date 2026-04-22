import { Platform } from 'react-native';
import type { ExportPresentationMode } from '@/components/foundry/export/exportFilterTypes';
import {
  EXPORT_COLUMNS_BY_KEY,
  type ExportColumnDefinition,
} from '@/components/foundry/export/exportColumns';
import type { ExportRow } from '@/components/foundry/export/exportRows';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function resolveExportColumns(
  visibleColumnKeys: string[],
  mode: ExportPresentationMode,
): ExportColumnDefinition[] {
  return visibleColumnKeys
    .map((key) => EXPORT_COLUMNS_BY_KEY.get(key))
    .filter((column): column is ExportColumnDefinition => column != null && column.modes.includes(mode));
}

export function exportRowsToCsv(
  rows: ExportRow[],
  visibleColumnKeys: string[],
  mode: ExportPresentationMode,
): string {
  const columns = resolveExportColumns(visibleColumnKeys, mode);
  const header = columns.map((column) => column.key);
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) =>
          csvCell(column.csvValue ? column.csvValue(row) : (row as unknown as Record<string, unknown>)[column.key]),
        )
        .join(','),
    );
  }
  return lines.join('\n');
}

export function downloadCsvOnWeb(filename: string, csv: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
