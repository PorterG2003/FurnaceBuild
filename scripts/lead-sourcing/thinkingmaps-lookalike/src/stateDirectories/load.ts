import { join } from 'node:path';
import { isGenericEmail } from '../schoolContacts.js';
import { rowToRecord, writeCsv } from '../lib/csv.js';
import { writeJson } from '../lib/io.js';
import type { ListedSchool, RawSchoolContact } from '../types.js';
import { fetchStateFiles, readFetchedBuffer, STATE_SOURCE_URL, type FetchedStateFile } from './fetch.js';
import { matchToSchools } from './matchToSchools.js';
import { parseAl } from './parseAl.js';
import { parseCa } from './parseCa.js';
import { parseCo } from './parseCo.js';
import { parseFl } from './parseFl.js';
import { parseGa } from './parseGa.js';
import { parseHi } from './parseHi.js';
import { parseId } from './parseId.js';
import { parseIl } from './parseIl.js';
import { parseKy } from './parseKy.js';
import { parseNv } from './parseNv.js';
import { parseOr } from './parseOr.js';
import { parseTn } from './parseTn.js';
import { parseTx } from './parseTx.js';
import { parseUt } from './parseUt.js';
import { parseVa } from './parseVa.js';
import { hasPersonName, titleCaseName } from './parse.js';
import type {
  MatchedStateRow,
  ParseResult,
  StateCoverageRow,
  StateDirectoryPeopleRow,
  StateDirectoryRow,
  StateDirectoryState,
} from './types.js';
import { STATE_DIRECTORY_BLOCKERS } from './blockers.js';
import { STATE_DIRECTORY_STATES } from './types.js';

export const RAW_COLUMNS = [
  'source_state',
  'state_school_id',
  'nces_school_id',
  'district_name',
  'school_name',
  'city',
  'zip',
  'first_name',
  'last_name',
  'title',
  'email',
  'match_status',
  'ncessch',
  'leaid',
  'matched_school_name',
  'match_score',
  'match_method',
] as const;

export const PEOPLE_COLUMNS = [
  'leaid',
  'ncessch',
  'school_name',
  'first_name',
  'last_name',
  'title',
  'school_hint',
  'source_url',
  'platform',
] as const;

export const COVERAGE_COLUMNS = [
  'source_state',
  'parsed',
  'with_name',
  'matched',
  'ambiguous',
  'unmatched',
  'with_email',
  'contacts',
  'people',
] as const;

export const CONTACT_EXPORT_COLUMNS = [
  'ncessch',
  'leaid',
  'school_name',
  'first_name',
  'last_name',
  'title',
  'email',
  'linkedin_url',
  'company',
  'phone',
  'provider',
  'email_risk',
  'person_id',
] as const;

async function parseFetched(file: FetchedStateFile): Promise<ParseResult> {
  const buffer = readFetchedBuffer(file);
  const text = buffer.toString('utf8');
  if (file.state === 'CA') return parseCa(text);
  if (file.state === 'TX') return parseTx(text);
  if (file.state === 'CO') return parseCo(buffer);
  if (file.state === 'IL') return parseIl(buffer);
  if (file.state === 'GA') return parseGa(text);
  if (file.state === 'KY') return parseKy(text);
  if (file.state === 'NV') return parseNv(buffer);
  if (file.state === 'HI') return parseHi(text);
  if (file.state === 'UT') return parseUt(text);
  if (file.state === 'VA') return parseVa(text);
  if (file.state === 'ID') return parseId(text);
  if (file.state === 'TN') return parseTn(buffer, file.path);
  if (file.state === 'OR') return parseOr(buffer);
  if (file.state === 'AL') return parseAl(buffer, file.path);
  return parseFl(buffer, file.path);
}

function usableEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  return value.includes('@') && !isGenericEmail(value);
}

function toContact(row: MatchedStateRow): RawSchoolContact {
  const first = titleCaseName(row.first_name);
  const last = titleCaseName(row.last_name);
  const schoolName = row.matched_school_name || row.school_name;
  return {
    ncessch: row.ncessch,
    leaid: row.leaid,
    school_name: schoolName,
    first_name: first,
    last_name: last,
    title: row.title || 'Principal',
    email: row.email.trim().toLowerCase(),
    linkedin_url: '',
    company: schoolName,
    phone: '',
    provider: 'state_agency',
    email_risk: '',
    person_id: `state:${row.source_state}:${row.state_school_id}:${row.email || `${first}.${last}`}`,
  };
}

function toPeople(row: MatchedStateRow): StateDirectoryPeopleRow {
  return {
    leaid: row.leaid,
    ncessch: row.ncessch,
    school_name: row.matched_school_name || row.school_name,
    first_name: titleCaseName(row.first_name),
    last_name: titleCaseName(row.last_name),
    title: row.title || 'Principal',
    school_hint: row.matched_school_name || row.school_name,
    source_url: STATE_SOURCE_URL[row.source_state],
    platform: 'state_agency',
  };
}

function coverageFor(state: string, parsed: StateDirectoryRow[], matched: MatchedStateRow[]): StateCoverageRow {
  const named = parsed.filter(hasPersonName).length;
  const hits = matched.filter((row) => row.match_status === 'matched');
  const withEmail = hits.filter((row) => usableEmail(row.email)).length;
  return {
    source_state: state,
    parsed: parsed.length,
    with_name: named,
    matched: hits.length,
    ambiguous: matched.filter((row) => row.match_status === 'ambiguous').length,
    unmatched: matched.filter((row) => row.match_status === 'unmatched').length,
    with_email: withEmail,
    contacts: withEmail,
    people: hits.length - withEmail,
  };
}

export type StateDirectoryFill = {
  contacts: RawSchoolContact[];
  people: StateDirectoryPeopleRow[];
  coverage: StateCoverageRow[];
  matched: MatchedStateRow[];
  districtStaff: StateDirectoryRow[];
  fetched: FetchedStateFile[];
  failures: Array<{ state: string; message: string }>;
};

const BLOCKER_COLUMNS = ['state', 'remaining_zeros', 'problem', 'source_url'] as const;

export function writeStateDirectoryBlockers(options: {
  runDir: string;
  schoolCoverage?: Array<{ state: string; contact_count: number }>;
  failures?: Array<{ state: string; message: string }>;
}): void {
  const zeros = new Map<string, number>();
  for (const row of options.schoolCoverage ?? []) {
    if (row.contact_count === 0) zeros.set(row.state, (zeros.get(row.state) ?? 0) + 1);
  }
  const failByState = new Map((options.failures ?? []).map((row) => [row.state, row.message]));
  const rows = STATE_DIRECTORY_BLOCKERS.map((row) => {
    const failed = failByState.get(row.state);
    const shortFail = failed ? failed.split(/\n/)[0]!.trim().slice(0, 220) : '';
    return {
      state: row.state,
      remaining_zeros: String(zeros.get(row.state) ?? row.remaining_zeros),
      problem: shortFail ? `FETCH FAILED: ${shortFail}. ${row.problem}` : row.problem,
      source_url: row.source_url,
    };
  });
  for (const [state, message] of failByState) {
    if (rows.some((row) => row.state === state)) continue;
    rows.push({
      state,
      remaining_zeros: String(zeros.get(state) ?? ''),
      problem: `FETCH FAILED: ${message}`,
      source_url: STATE_SOURCE_URL[state as StateDirectoryState] ?? '',
    });
  }
  rows.sort((a, b) => Number(b.remaining_zeros || 0) - Number(a.remaining_zeros || 0) || a.state.localeCompare(b.state));
  writeCsv(join(options.runDir, 'state_directory_blockers.csv'), rows.map((row) => rowToRecord(row)), BLOCKER_COLUMNS);
}

export async function fillStateDirectories(options: {
  runDir: string;
  schools: ListedSchool[];
  fixtures?: boolean;
  refresh?: boolean;
  states?: StateDirectoryState[];
}): Promise<StateDirectoryFill> {
  const states = options.states ?? [...STATE_DIRECTORY_STATES];
  const fetched: FetchedStateFile[] = [];
  const parsedRows: StateDirectoryRow[] = [];
  const districtStaff: StateDirectoryRow[] = [];
  const coverage: StateCoverageRow[] = [];
  const matchedAll: MatchedStateRow[] = [];
  const failures: Array<{ state: string; message: string }> = [];

  for (const state of states) {
    try {
      const files = await fetchStateFiles({
        fixtures: options.fixtures,
        refresh: options.refresh,
        states: [state],
      });
      const file = files[0];
      if (!file) throw new Error(`No file returned for ${state}`);
      fetched.push(file);
      const parsed = await parseFetched(file);
      parsedRows.push(...parsed.rows);
      districtStaff.push(...parsed.districtStaff);
      const matched = matchToSchools(parsed.rows, options.schools);
      matchedAll.push(...matched);
      coverage.push(coverageFor(state, parsed.rows, matched));
      console.error(
        `[state-directories] ${state} parsed=${parsed.rows.length} matched=${coverage.at(-1)?.matched ?? 0} with_email=${coverage.at(-1)?.with_email ?? 0} from_cache=${file.fromCache} path=${file.path}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[state-directories] ${state} FAILED: ${message}`);
      failures.push({ state, message });
      coverage.push({
        source_state: state,
        parsed: 0,
        with_name: 0,
        matched: 0,
        ambiguous: 0,
        unmatched: 0,
        with_email: 0,
        contacts: 0,
        people: 0,
      });
    }
  }

  const hits = matchedAll.filter((row) => row.match_status === 'matched');
  const contacts = hits.filter((row) => usableEmail(row.email)).map(toContact);
  const people = hits.filter((row) => !usableEmail(row.email)).map(toPeople);

  writeCsv(join(options.runDir, 'state_directory_raw.csv'), matchedAll.map((row) => rowToRecord(row)), RAW_COLUMNS);
  writeCsv(
    join(options.runDir, 'state_directory_contacts.csv'),
    contacts.map((row) => rowToRecord(row)),
    CONTACT_EXPORT_COLUMNS,
  );
  writeCsv(join(options.runDir, 'state_directory_people.csv'), people.map((row) => rowToRecord(row)), PEOPLE_COLUMNS);
  writeCsv(
    join(options.runDir, 'state_directory_coverage.csv'),
    coverage.map((row) => rowToRecord(row)),
    COVERAGE_COLUMNS,
  );
  writeCsv(
    join(options.runDir, 'state_district_staff.csv'),
    districtStaff.map((row) => rowToRecord(row)),
    [
      'source_state',
      'state_school_id',
      'district_name',
      'school_name',
      'city',
      'zip',
      'first_name',
      'last_name',
      'title',
      'email',
    ],
  );
  writeJson(join(options.runDir, 'state_directory_summary.json'), {
    fetched: fetched.map((row) => ({ state: row.state, path: row.path, fromCache: row.fromCache })),
    coverage,
    contacts: contacts.length,
    people: people.length,
    district_staff: districtStaff.length,
    failures,
  });
  writeStateDirectoryBlockers({ runDir: options.runDir, failures });

  return { contacts, people, coverage, matched: matchedAll, districtStaff, fetched, failures };
}
