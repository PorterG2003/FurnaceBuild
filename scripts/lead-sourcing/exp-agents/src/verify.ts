import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, saveJson } from './checkpoint.ts';
import { readCsv } from './csv.ts';
import {
  COUNTRY_LOCATIONS,
  type CountryCode,
  type EnumerationCheckpoint,
} from './types.ts';

type VerificationReport = {
  verifiedAt: string;
  ok: boolean;
  complete: boolean;
  rows: number;
  uniqueIds: number;
  duplicateIds: string[];
  poisonRows: Array<{ id: string; field: string; value: string }>;
  sliceMismatches: Array<{
    slice: string;
    reported: number | null;
    checkpointWritten: number;
    csvRows: number;
    done: boolean;
  }>;
  knownUsNames: {
    expected: number;
    found: number;
    missing: string[];
  };
  errors: string[];
};

const PACKAGE_ROOT = join(import.meta.dirname, '..');

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function loadKnownUsNames(): string[] {
  const path = join(PACKAGE_ROOT, 'output', 'runs', 'us-ca-full', 'suggestions_us.jsonl');
  if (!existsSync(path)) return [];
  const names = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { name?: string };
      if (parsed.name) names.add(parsed.name);
    } catch {
      // The source file is append-only; ignore an incomplete final line.
    }
  }
  return [...names];
}

function isSuspiciousCity(value: string): boolean {
  // French accents are valid in Canadian city names. Prior poison payloads
  // used non-Latin scripts and long unbroken tokens.
  return (
    /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Arabic}]/u.test(value) ||
    (value.length > 30 && !/[\s'-]/.test(value))
  );
}

export function verifyRun(runDirInput: string): VerificationReport {
  const runDir = isAbsolute(runDirInput)
    ? runDirInput
    : resolve(PACKAGE_ROOT, runDirInput);
  const csvPath = join(runDir, 'agents.csv');
  const checkpointPath = join(runDir, 'enumeration_checkpoint.json');
  if (!existsSync(csvPath)) throw new Error(`missing agents.csv: ${csvPath}`);
  if (!existsSync(checkpointPath)) {
    throw new Error(`missing enumeration_checkpoint.json: ${checkpointPath}`);
  }

  const rows = readCsv(csvPath);
  const checkpoint = loadJson<EnumerationCheckpoint>(checkpointPath)!;
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();
  const poisonRows: VerificationReport['poisonRows'] = [];
  const csvSliceCounts = new Map<string, number>();
  const normalizedAgentNames = new Set<string>();

  for (const row of rows) {
    if (!row.id || ids.has(row.id)) {
      if (row.id) duplicateIds.add(row.id);
    } else {
      ids.add(row.id);
    }
    if (/[^\u0000-\u007f]/.test(row.email ?? '')) {
      poisonRows.push({ id: row.id ?? '', field: 'email', value: row.email ?? '' });
    }
    if (isSuspiciousCity(row.city ?? '')) {
      poisonRows.push({ id: row.id ?? '', field: 'city', value: row.city ?? '' });
    }
    const location = (row.source_name_query ?? '').replace(/^location:/, '');
    const key = `${row.country}/${location}`;
    csvSliceCounts.set(key, (csvSliceCounts.get(key) ?? 0) + 1);
    normalizedAgentNames.add(
      normalizeName(`${row.first_name ?? ''} ${row.last_name ?? ''}`),
    );
  }

  const sliceMismatches: VerificationReport['sliceMismatches'] = [];
  let complete = checkpoint.done;
  for (const country of Object.keys(COUNTRY_LOCATIONS) as CountryCode[]) {
    const countryState = checkpoint.countries[country];
    if (!countryState?.done) complete = false;
    for (const location of COUNTRY_LOCATIONS[country]) {
      const state = countryState?.slices[location];
      const key = `${country}/${location}`;
      const csvRows = csvSliceCounts.get(key) ?? 0;
      const reported = state?.reportedCount ?? null;
      const checkpointWritten = state?.rowsWritten ?? 0;
      const done = state?.done ?? false;
      if (!done) complete = false;
      if (
        !state ||
        !done ||
        reported == null ||
      state.nextFrom !== reported ||
        checkpointWritten !== csvRows
      ) {
        sliceMismatches.push({
          slice: key,
          reported,
          checkpointWritten,
          csvRows,
          done,
        });
      }
    }
  }

  const knownNames = loadKnownUsNames();
  const missingNames = knownNames.filter(
    (name) => !normalizedAgentNames.has(normalizeName(name)),
  );
  const errors: string[] = [];
  if (!complete) errors.push('enumeration checkpoint is incomplete');
  if (duplicateIds.size) errors.push(`${duplicateIds.size} duplicate agent ids`);
  if (poisonRows.length) errors.push(`${poisonRows.length} suspicious poison rows`);
  if (sliceMismatches.length) errors.push(`${sliceMismatches.length} slice count mismatches`);
  if (missingNames.length) {
    errors.push(`${missingNames.length}/${knownNames.length} known US names missing`);
  }

  return {
    verifiedAt: new Date().toISOString(),
    ok: errors.length === 0,
    complete,
    rows: rows.length,
    uniqueIds: ids.size,
    duplicateIds: [...duplicateIds],
    poisonRows,
    sliceMismatches,
    knownUsNames: {
      expected: knownNames.length,
      found: knownNames.length - missingNames.length,
      missing: missingNames,
    },
    errors,
  };
}

function main(): void {
  const runDir = process.argv[2] ?? 'output/runs/us-ca-enumeration';
  const absoluteRunDir = isAbsolute(runDir) ? runDir : resolve(PACKAGE_ROOT, runDir);
  const report = verifyRun(runDir);
  saveJson(join(absoluteRunDir, 'verification_report.json'), report);

  const summaryPath = join(absoluteRunDir, 'run_summary.json');
  const summary = loadJson<Record<string, unknown>>(summaryPath) ?? {};
  saveJson(summaryPath, {
    ...summary,
    verifiedAt: report.verifiedAt,
    verificationOk: report.ok,
    verificationReport: join(absoluteRunDir, 'verification_report.json'),
  });

  console.log(
    `[verify] ok=${report.ok} complete=${report.complete} rows=${report.rows} unique=${report.uniqueIds} knownNames=${report.knownUsNames.found}/${report.knownUsNames.expected}`,
  );
  if (!report.ok) {
    for (const error of report.errors) console.error(`[verify] ${error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
