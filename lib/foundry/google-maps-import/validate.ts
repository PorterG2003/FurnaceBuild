/**
 * Google Maps CSV row validation — keep in sync with
 * amplify/functions/foundryRegistryApi/validateImport.ts (Lambda bundle).
 */

export type RowValidationStatus = 'valid' | 'warning' | 'error';

export interface ColumnMap {
  nameRawHeader: string;
  addressRawHeader: string;
  websiteHeader: string | null;
  phoneHeader: string | null;
}

export interface ClassifiedRow {
  rowNumber: number;
  nameRaw: string;
  addressRaw: string;
  websiteRaw: string | null;
  phoneRaw: string | null;
  normalizedWebsitePreview: string;
  status: RowValidationStatus;
  issues: string[];
  /** Original CSV row keyed by header */
  rawRow: Record<string, string>;
}

const WEBSITE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeWebsitePreview(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  try {
    if (HAS_SCHEME_RE.test(s)) {
      const u = new URL(s);
      s = u.hostname || s;
    } else {
      s = s.replace(/^\/\//, '');
      const slash = s.indexOf('/');
      if (slash >= 0) s = s.slice(0, slash);
    }
  } catch {
    // keep trimmed string for preview
  }
  s = s.replace(/^www\./i, '');
  return s.toLowerCase();
}

function looksLikeMalformedWebsite(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  const preview = normalizeWebsitePreview(t);
  if (!preview) return true;
  if (preview.includes(' ') || preview.includes('..')) return true;
  if (!WEBSITE_HOST_RE.test(preview) && !preview.includes('.')) return true;
  return false;
}

function normalizeNameAddressKey(name: string, address: string): string {
  return `${name.trim().toLowerCase()}\n${address.trim().toLowerCase()}`;
}

export function getCell(row: Record<string, string>, header: string | null): string {
  if (!header) return '';
  const v = row[header];
  return v != null ? String(v).trim() : '';
}

export interface DuplicateMaps {
  websiteCounts: Map<string, number>;
  nameAddressCounts: Map<string, number>;
}

export function buildDuplicateMaps(
  rows: Record<string, string>[],
  columnMap: ColumnMap,
): DuplicateMaps {
  const websiteCounts = new Map<string, number>();
  const nameAddressCounts = new Map<string, number>();

  rows.forEach((row) => {
    const name = getCell(row, columnMap.nameRawHeader);
    const addr = getCell(row, columnMap.addressRawHeader);
    const webRaw = columnMap.websiteHeader ? getCell(row, columnMap.websiteHeader) : '';
    const wKey = normalizeWebsitePreview(webRaw);
    if (wKey) {
      websiteCounts.set(wKey, (websiteCounts.get(wKey) ?? 0) + 1);
    }
    if (name && addr) {
      const na = normalizeNameAddressKey(name, addr);
      nameAddressCounts.set(na, (nameAddressCounts.get(na) ?? 0) + 1);
    }
  });

  return { websiteCounts, nameAddressCounts };
}

export function classifyAllRows(
  rows: Record<string, string>[],
  columnMap: ColumnMap,
): ClassifiedRow[] {
  const { websiteCounts, nameAddressCounts } = buildDuplicateMaps(rows, columnMap);

  return rows.map((row, i) => {
    const rowNumber = i + 1;
    const nameRaw = getCell(row, columnMap.nameRawHeader);
    const addressRaw = getCell(row, columnMap.addressRawHeader);
    const websiteRaw = columnMap.websiteHeader ? getCell(row, columnMap.websiteHeader) : '';
    const phoneRaw = columnMap.phoneHeader ? getCell(row, columnMap.phoneHeader) : '';
    const websiteOrNull = websiteRaw === '' ? null : websiteRaw;
    const phoneOrNull = phoneRaw === '' ? null : phoneRaw;
    const normalizedWebsitePreview = normalizeWebsitePreview(websiteRaw);

    const issues: string[] = [];
    let status: RowValidationStatus = 'valid';

    if (!nameRaw) {
      issues.push('Error: business name missing');
      status = 'error';
    }
    if (!addressRaw) {
      issues.push('Error: address missing');
      status = 'error';
    }

    if (status === 'error') {
      return {
        rowNumber,
        nameRaw,
        addressRaw,
        websiteRaw: websiteOrNull,
        phoneRaw: phoneOrNull,
        normalizedWebsitePreview,
        status,
        issues,
        rawRow: { ...row },
      };
    }

    if (!websiteRaw) {
      issues.push('Warning: website missing');
      status = 'warning';
    } else if (looksLikeMalformedWebsite(websiteRaw)) {
      issues.push('Warning: website looks malformed');
      status = 'warning';
    }

    const wKey = normalizeWebsitePreview(websiteRaw);
    if (wKey && (websiteCounts.get(wKey) ?? 0) > 1) {
      issues.push('Warning: duplicate website in file');
      status = 'warning';
    }

    const naKey = normalizeNameAddressKey(nameRaw, addressRaw);
    if ((nameAddressCounts.get(naKey) ?? 0) > 1) {
      issues.push('Warning: duplicate name + address in file');
      status = 'warning';
    }

    return {
      rowNumber,
      nameRaw,
      addressRaw,
      websiteRaw: websiteOrNull,
      phoneRaw: phoneOrNull,
      normalizedWebsitePreview,
      status,
      issues,
      rawRow: { ...row },
    };
  });
}

export function summarizeClassification(rows: ClassifiedRow[]): {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
} {
  let validRows = 0;
  let warningRows = 0;
  let errorRows = 0;
  for (const r of rows) {
    if (r.status === 'valid') validRows += 1;
    else if (r.status === 'warning') warningRows += 1;
    else errorRows += 1;
  }
  return { totalRows: rows.length, validRows, warningRows, errorRows };
}
