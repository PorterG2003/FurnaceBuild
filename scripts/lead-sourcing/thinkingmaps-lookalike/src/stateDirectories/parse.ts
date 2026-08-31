import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { padNcessch, zip5 } from '../schoolNames.js';
import type { ParseResult, StateDirectoryRow, StateDirectoryState } from './types.js';

export function blankRow(state: StateDirectoryState): StateDirectoryRow {
  return {
    source_state: state,
    state_school_id: '',
    nces_school_id: '',
    district_name: '',
    school_name: '',
    city: '',
    zip: '',
    first_name: '',
    last_name: '',
    title: '',
    email: '',
  };
}

export function hasPersonName(row: Pick<StateDirectoryRow, 'first_name' | 'last_name'>): boolean {
  return Boolean(row.first_name.trim() && row.last_name.trim());
}

export function digits(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || /^no data$/i.test(trimmed)) return '';
  return trimmed.replace(/\D/g, '');
}

export function ncesFromParts(district: string, school: string): string {
  const dist = digits(district);
  const sch = digits(school);
  if (dist.length < 7 || !sch) return '';
  return padNcessch(`${dist.slice(-7)}${sch.padStart(5, '0')}`);
}

export function normHeader(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function pickField(row: Record<string, string>, aliases: string[]): string {
  const entries = Object.entries(row).map(([key, value]) => [normHeader(key), (value ?? '').trim()] as const);
  for (const alias of aliases.map(normHeader)) {
    const exact = entries.find(([key]) => key === alias);
    if (exact) return exact[1];
  }
  for (const alias of aliases.map(normHeader)) {
    const hits = entries.filter(([key]) => key.includes(alias));
    if (hits.length === 1) return hits[0]![1];
  }
  return '';
}

export function splitPersonName(value: string): { first: string; last: string } {
  const trimmed = cleanPersonToken(value);
  if (!trimmed) return { first: '', last: '' };
  if (trimmed.includes(',')) {
    const [last, rest] = trimmed.split(',', 2);
    const given = cleanPersonToken(rest ?? '')
      .split(/\s+/)
      .filter((part) => part && !HONORIFIC.test(part));
    return { first: given[0] ?? '', last: cleanPersonToken(last ?? '') };
  }
  const parts = trimmed.split(/\s+/).filter((part) => part && !HONORIFIC.test(part));
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

const HONORIFIC = /^(dr|mr|ms|mrs|miss|fr|sr|br)\.?$/i;

export function cleanPersonToken(value: string): string {
  return (value ?? '')
    .replace(/\s*"[^"]*"\s*/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleCaseName(value: string): string {
  return (value ?? '')
    .trim()
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim()) return part;
      return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

export function normalizeEmail(value: string): string {
  const email = (value ?? '').trim().toLowerCase().replace(/^mailto:/, '');
  if (!email.includes('@')) return '';
  const local = email.split('@')[0] ?? '';
  if (/^\d+$/.test(local)) return '';
  return email;
}

export function stripLeadingCode(value: string): string {
  const trimmed = (value ?? '').trim();
  const stripped = trimmed.replace(/^\d+\s*[-–—:]\s*/, '').trim();
  return stripped || trimmed;
}

export function extractJsArray<T>(html: string, varName: string): T[] {
  const match = html.match(new RegExp(`(?:var|let|const)\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;`));
  if (!match?.[1]) return [];
  try {
    return JSON.parse(match[1]) as T[];
  } catch {
    return [];
  }
}

export function sniffDelimiter(text: string): string {
  const first = (text.split(/\r?\n/, 1)[0] ?? '').replace(/^\uFEFF/, '');
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

export function parseDelimited(text: string, delimiter?: string): Record<string, string>[] {
  const raw = text.replace(/^\uFEFF/, '');
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    delimiter: delimiter ?? sniffDelimiter(raw),
    trim: true,
  }) as Record<string, string>[];
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const rec = value as {
      text?: string;
      result?: unknown;
      hyperlink?: string;
      richText?: Array<{ text?: string }>;
    };
    if (Array.isArray(rec.richText)) return rec.richText.map((part) => part.text ?? '').join('').trim();
    if (typeof rec.text === 'string' && rec.text.trim()) return rec.text.trim();
    if (typeof rec.hyperlink === 'string') return rec.hyperlink.trim();
    if (rec.result != null) return cellToString(rec.result);
  }
  return String(value).trim();
}

export function recordsFromSheet(sheet: ExcelJS.Worksheet): Record<string, string>[] {
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) cells.push(cellToString(row.getCell(i).value));
    if (cells.some((cell) => cell)) matrix.push(cells);
  });
  const headerIndex = matrix.findIndex((row) => {
    const nonempty = row.filter((cell) => cell);
    const unique = new Set(nonempty.map((cell) => cell.toLowerCase().trim()));
    if (unique.size < 4) return false;
    if (nonempty.length >= 8) return true;
    const joined = nonempty.map((cell) => cell.toLowerCase()).join(' ');
    return nonempty.length >= 3 && /principal/.test(joined) && /name/.test(joined);
  });
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex]!.map((cell, i) => cell || `col_${i}`);
  return matrix.slice(headerIndex + 1).map((row) => {
    const rec: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) rec[headers[i]!] = row[i] ?? '';
    return rec;
  });
}

export async function recordsFromWorkbook(
  buffer: Buffer,
  sheetHint?: string | string[],
): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const hints = sheetHint == null ? [] : Array.isArray(sheetHint) ? sheetHint : [sheetHint];
  const hinted = hints.length
    ? workbook.worksheets.find((sheet) =>
        hints.some((hint) => sheet.name.toLowerCase().includes(hint.toLowerCase())),
      )
    : undefined;
  const sheet = hinted ?? workbook.worksheets[0];
  if (!sheet) return [];
  return recordsFromSheet(sheet);
}

export async function parseTableBuffer(buffer: Buffer, sheetHint?: string): Promise<Record<string, string>[]> {
  const start = buffer.subarray(0, 4);
  const isZip = start[0] === 0x50 && start[1] === 0x4b;
  if (isZip) return recordsFromWorkbook(buffer, sheetHint);
  if (start[0] === 0xd0 && start[1] === 0xcf) {
    throw new Error('Legacy .xls (Excel 97) is not supported; use xlsx or csv');
  }
  return parseDelimited(buffer.toString('utf8'));
}

export function zipOf(row: Record<string, string>, aliases = ['zip', 'zip code', 'zipcode', 'mailing zip', 'physical zip']): string {
  return zip5(pickField(row, aliases));
}

export function emptyParse(): ParseResult {
  return { rows: [], districtStaff: [] };
}
