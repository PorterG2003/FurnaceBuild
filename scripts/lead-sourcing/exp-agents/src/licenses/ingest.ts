import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCsv } from '../csv.ts';
import type { LicenseRecord } from '../brokerExpansionTypes.ts';
import type { LicenseSourceMeta } from './types.ts';
import {
  normalizeCaDreRow,
  normalizeFlDbprRow,
  normalizeTxTrecRow,
} from './normalize.ts';

function sha256File(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function parseCsvLineLocal(line: string): string[] {
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

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function extractZip(zipPath: string, destDir: string): string[] {
  ensureDir(destDir);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'pipe' });
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(destDir);
  return out;
}

function loadTabularRows(path: string, source?: 'ca_dre' | 'tx_trec' | 'fl_dbpr'): Record<string, string>[] {
  const ext = extname(path).toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    // TX bulk files are sometimes pipe-delimited; try CSV first then pipe.
    const text = readFileSync(path, 'utf8');
    if (text.includes('|') && !text.includes(',')) {
      const lines = text.trim().split(/\r?\n/);
      if (!lines.length) return [];
      const headers = lines[0].split('|').map((value) => value.trim());
      return lines.slice(1).filter(Boolean).map((line) => {
        const values = line.split('|');
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = (values[index] ?? '').trim();
        });
        return row;
      });
    }
    // Florida DBPR weekly extract is headerless positional CSV.
    if (source === 'fl_dbpr' && /^"?2501\b/.test(text.trim())) {
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const rows: Record<string, string>[] = [];
      for (const line of lines) {
        const values = parseCsvLineLocal(line);
        if (!values.length) continue;
        rows.push({
          Profession: values[0] ?? '',
          'Full Name': values[1] ?? '',
          'License Type': values[3] ?? '',
          Address: values[4] ?? '',
          City: values[7] ?? '',
          State: values[8] ?? '',
          Zip: values[9] ?? '',
          County: values[10] ?? '',
          'License Number': values[17] || values[11] || '',
          'License Status': values[12] ?? '',
          Activity: values[13] ?? '',
          'Expiration Date': values[16] ?? '',
          'Business Name': values[19] ?? '',
        });
      }
      return rows;
    }
    return readCsv(path);
  }
  if (ext === '.xlsx' || ext === '.xls') {
    // Prefer CSV/TXT fixtures; Excel support is best-effort via `ssconvert` if present.
    try {
      const csvPath = `${path}.converted.csv`;
      execFileSync('ssconvert', [path, csvPath], { stdio: 'pipe' });
      return readCsv(csvPath);
    } catch {
      throw new Error(
        `Excel source requires conversion to CSV (or ssconvert): ${path}`,
      );
    }
  }
  throw new Error(`Unsupported license source format: ${path}`);
}

export function ingestLicenseFile(options: {
  source: 'ca_dre' | 'tx_trec' | 'fl_dbpr';
  inputPath: string;
  runDir: string;
  sourceUrl?: string;
}): { records: LicenseRecord[]; meta: LicenseSourceMeta } {
  const abs = resolve(options.inputPath);
  if (!existsSync(abs)) throw new Error(`license source missing: ${abs}`);
  const sourcesDir = join(options.runDir, 'sources', options.source);
  const extractedDir = join(sourcesDir, 'extracted');
  ensureDir(sourcesDir);
  ensureDir(extractedDir);

  const label = basename(abs);
  const copiedTo = join(sourcesDir, label);
  copyFileSync(abs, copiedTo);
  const digest = sha256File(copiedTo);
  const downloadedAt = new Date().toISOString();

  let tabularPaths = [copiedTo];
  if (extname(copiedTo).toLowerCase() === '.zip') {
    tabularPaths = extractZip(copiedTo, extractedDir).filter((path) =>
      /\.(csv|txt|xlsx|xls)$/i.test(path),
    );
    if (!tabularPaths.length) {
      throw new Error(`ZIP contained no tabular license files: ${abs}`);
    }
  }

  const normalize =
    options.source === 'ca_dre'
      ? normalizeCaDreRow
      : options.source === 'tx_trec'
        ? normalizeTxTrecRow
        : normalizeFlDbprRow;

  const records: LicenseRecord[] = [];
  for (const path of tabularPaths) {
    for (const row of loadTabularRows(path, options.source)) {
      const normalized = normalize(row);
      if (normalized) records.push(normalized);
    }
  }

  const meta: LicenseSourceMeta = {
    source: options.source,
    path: abs,
    copiedTo,
    sha256: digest,
    downloadedAt,
    sourceUrl: options.sourceUrl ?? '',
    rowCount: records.length,
  };
  writeFileSync(
    join(sourcesDir, 'source_meta.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );
  return { records, meta };
}
