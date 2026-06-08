import { formatCellValue } from './resolveCellValue.js';
import type { LeadsColumnDef, LeadsTableRow } from './types.js';

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
