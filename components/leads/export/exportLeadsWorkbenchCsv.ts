import type { LeadsColumnDef, LeadsTableRow } from '@/lib/leads/columns';
import { formatCellValue } from '@/lib/leads/columns/resolveCellValue';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const normalized =
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

export function exportLeadsWorkbenchToCsv(rows: LeadsTableRow[], columns: LeadsColumnDef[]): string {
  const visibleColumns = columns.filter((column) => column.visible);
  const header = visibleColumns.map((column) => csvCell(column.label)).join(',');
  const lines = [header];

  for (const row of rows) {
    lines.push(
      visibleColumns
        .map((column) => {
          const formatted = formatCellValue(column, row.cells[column.id] ?? null);
          return csvCell(formatted === '—' ? '' : formatted);
        })
        .join(','),
    );
  }

  return lines.join('\n');
}

export function downloadCsvOnWeb(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
