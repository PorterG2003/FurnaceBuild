import Papa from 'papaparse';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

const UTF8_BOM = '\ufeff';

/** RFC 4180 CSV with header row; trims headers and cell values. */
export function parseGoogleMapsCsv(csvText: string): ParsedCsv {
  const trimmed = csvText.trim();
  if (!trimmed.length) {
    return { headers: [], rows: [] };
  }
  const withoutBOM = trimmed.startsWith(UTF8_BOM) ? trimmed.slice(UTF8_BOM.length) : trimmed;

  const result = Papa.parse<Record<string, string>>(withoutBOM, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    const msg = first?.message
      ? `Invalid CSV: ${first.message}`
      : 'Invalid CSV: check that the file has a header row and that commas inside cells are in quoted fields.';
    throw new Error(msg);
  }

  const fields = result.meta.fields ?? [];
  const headers = fields.length > 0 ? fields : result.data[0] ? Object.keys(result.data[0]) : [];

  const rows: Record<string, string>[] = result.data.map((row) => {
    const out: Record<string, string> = {};
    headers.forEach((header) => {
      const val = row[header];
      out[header] = val != null ? String(val).trim() : '';
    });
    return out;
  });

  return { headers, rows };
}
