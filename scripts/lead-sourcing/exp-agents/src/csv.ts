import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function writeCsv<T extends Record<string, string>>(
  path: string,
  columns: (keyof T & string)[],
  rows: T[],
): void {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(row[c] ?? '')).join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export function appendCsvRows<T extends Record<string, string>>(
  path: string,
  columns: (keyof T & string)[],
  rows: T[],
): void {
  if (!rows.length) return;
  if (!existsSync(path)) {
    writeCsv(path, columns, rows);
    return;
  }
  const lines = rows.map((row) => columns.map((c) => escapeCsv(row[c] ?? '')).join(','));
  writeFileSync(path, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'a' });
}

export function readCsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
