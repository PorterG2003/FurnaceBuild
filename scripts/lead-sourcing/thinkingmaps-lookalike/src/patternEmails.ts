import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptPatternResult, guessEmailPatterns, type EmailPatternGuess } from '../../email-from-linkedin/src/patternGuess.js';
import { verifyEmailWithMillionVerifier } from '../../email-from-linkedin/src/millionVerifier.js';
import type { HarvestedPerson } from './adapters/types.js';
import { readCsv } from './lib/csv.js';
import { loadJson } from './lib/io.js';
import { mapWithConcurrency } from './lib/pool.js';
import { loadDistrictSitesCsv, type DistrictSite } from './resolveDistrictSites.js';
import { attributePerson } from './schoolAttribution.js';
import type { ContactProvider, ListedSchool, RawSchoolContact } from './types.js';

export type PatternKind = EmailPatternGuess['pattern'];

type LearnedPattern = {
  domain: string;
  pattern: PatternKind | '';
  count: number;
};

export type PatternEmailCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  next_index: number;
  mv_calls: number;
  results: RawSchoolContact[];
  district_pattern: Record<string, PatternKind>;
};

type MissingRow = {
  leaid: string;
  ncessch: string;
  school_name: string;
  first_name: string;
  last_name: string;
  title: string;
  school_hint: string;
  source_url: string;
  platform: string;
  provider: ContactProvider;
};

function cleanToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function inferEmailPattern(local: string, firstName: string, lastName: string): PatternKind | '' {
  const first = cleanToken(firstName);
  const last = cleanToken(lastName.split(/\s+/).pop() ?? lastName);
  if (!first || !last) return '';
  const value = cleanToken(local);
  if (value === `${first}${last}` && local.includes('.')) return 'first.last';
  if (local.toLowerCase() === `${first}.${last}`) return 'first.last';
  if (value === `${first[0]}${last}`) return 'flast';
  if (value === `${first}${last}`) return 'firstlast';
  if (local.toLowerCase() === `${first}_${last}`) return 'first_last';
  if (value === first) return 'first';
  return '';
}

export function learnDistrictPatterns(contacts: RawSchoolContact[]): Map<string, LearnedPattern> {
  const byLeaid = new Map<string, Map<string, number>>();
  const patternCounts = new Map<string, Map<PatternKind, number>>();
  for (const row of contacts) {
    const email = row.email.trim().toLowerCase();
    if (!email.includes('@')) continue;
    const [local, domain] = email.split('@');
    if (!local || !domain) continue;
    const domains = byLeaid.get(row.leaid) ?? new Map<string, number>();
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
    byLeaid.set(row.leaid, domains);
    const pattern = inferEmailPattern(local, row.first_name, row.last_name);
    if (!pattern) continue;
    const counts = patternCounts.get(row.leaid) ?? new Map<PatternKind, number>();
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    patternCounts.set(row.leaid, counts);
  }
  const learned = new Map<string, LearnedPattern>();
  for (const [leaid, domains] of byLeaid) {
    const domain = [...domains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const patterns = patternCounts.get(leaid);
    const pattern = patterns ? [...patterns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' : '';
    learned.set(leaid, { domain, pattern, count: [...domains.values()].reduce((sum, n) => sum + n, 0) });
  }
  return learned;
}

function domainForRow(leaid: string, learned: Map<string, LearnedPattern>, sites: Map<string, DistrictSite>): string {
  const known = learned.get(leaid)?.domain;
  if (known) return known;
  const site = sites.get(leaid);
  const emailDomain = (site?.email_domain ?? '').replace(/^www\./, '').toLowerCase();
  if (emailDomain.includes('.')) return emailDomain;
  const host = (site?.host ?? '').replace(/^www\./, '').toLowerCase();
  return host.includes('.') ? host : '';
}

function loadMissingRows(runDir: string, maxRows: number | null): MissingRow[] {
  const rows: MissingRow[] = [];
  const reviewPath = join(runDir, 'directory_review.csv');
  if (existsSync(reviewPath)) {
    for (const row of readCsv(reviewPath)) {
      if ((row.reason ?? '') !== 'missing_email') continue;
      if (!(row.first_name ?? '').trim() || !(row.last_name ?? '').trim()) continue;
      rows.push({
        leaid: row.leaid ?? '',
        ncessch: '',
        school_name: '',
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        title: row.title ?? '',
        school_hint: row.school_hint ?? '',
        source_url: row.source_url ?? '',
        platform: row.platform ?? '',
        provider: 'directory',
      });
    }
  }
  const peoplePath = join(runDir, 'state_directory_people.csv');
  if (existsSync(peoplePath)) {
    for (const row of readCsv(peoplePath)) {
      if (!(row.first_name ?? '').trim() || !(row.last_name ?? '').trim()) continue;
      rows.push({
        leaid: row.leaid ?? '',
        ncessch: row.ncessch ?? '',
        school_name: row.school_name ?? '',
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        title: row.title ?? 'Principal',
        school_hint: row.school_hint || row.school_name || '',
        source_url: row.source_url ?? '',
        platform: row.platform || 'state_agency',
        provider: 'state_agency',
      });
    }
  }
  if (maxRows && maxRows > 0) return rows.slice(0, maxRows);
  return rows;
}

export function patternEmailEstimate(runDir: string, maxRows: number | null = null): {
  people: number;
  with_learned_pattern: number;
  with_domain: number;
  max_mv_calls: number;
  likely_mv_calls: number;
} {
  const contactsPath = join(runDir, 'directory_contacts_raw.csv');
  const contacts = existsSync(contactsPath)
    ? (readCsv(contactsPath) as unknown as RawSchoolContact[])
    : [];
  const learned = learnDistrictPatterns(contacts);
  const sites = existsSync(join(runDir, 'district_sites.csv'))
    ? new Map(loadDistrictSitesCsv(join(runDir, 'district_sites.csv')).map((row) => [row.leaid, row]))
    : new Map<string, DistrictSite>();
  const allPeople = loadMissingRows(runDir, maxRows);
  const existing = loadJson<PatternEmailCheckpoint>(checkpointPath(runDir));
  const start = existing?.next_index && existing.next_index > 0 ? existing.next_index : 0;
  const people = allPeople.slice(start);
  let withPattern = 0;
  let withDomain = 0;
  for (const row of people) {
    if (learned.get(row.leaid)?.pattern) withPattern += 1;
    if (domainForRow(row.leaid, learned, sites)) withDomain += 1;
  }
  return {
    people: people.length,
    with_learned_pattern: withPattern,
    with_domain: withDomain,
    max_mv_calls: withDomain * 5,
    likely_mv_calls: withPattern + (withDomain - withPattern) * 2,
  };
}

function checkpointPath(runDir: string): string {
  return join(runDir, 'pattern_emails_checkpoint.json');
}

function saveCheckpoint(runDir: string, checkpoint: PatternEmailCheckpoint): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function orderGuesses(guesses: EmailPatternGuess[], proven: PatternKind | ''): EmailPatternGuess[] {
  if (!proven) return guesses;
  return [...guesses.filter((row) => row.pattern === proven), ...guesses.filter((row) => row.pattern !== proven)];
}

const LIVE_CONCURRENCY = 20;

function createLock(): <T>(fn: () => T | Promise<T>) => Promise<T> {
  let chain = Promise.resolve();
  return async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function acceptedContact(
  row: MissingRow,
  accepted: EmailPatternGuess,
  byNcessch: Map<string, ListedSchool>,
  byLeaid: Map<string, ListedSchool[]>,
): RawSchoolContact | null {
  if (row.ncessch) {
    const school = byNcessch.get(row.ncessch);
    return {
      ncessch: row.ncessch,
      leaid: row.leaid || school?.leaid || '',
      school_name: row.school_name || school?.school_name || '',
      first_name: row.first_name,
      last_name: row.last_name,
      title: row.title,
      email: accepted.email,
      linkedin_url: '',
      company: row.school_name || school?.school_name || '',
      phone: '',
      provider: row.provider,
      email_risk: '',
      person_id: `${accepted.email}|${accepted.pattern}`,
    };
  }
  const person: HarvestedPerson = {
    first_name: row.first_name,
    last_name: row.last_name,
    title: row.title,
    email: accepted.email,
    school_hint: row.school_hint,
    source_url: row.source_url,
    evidence: 'location_field',
    platform: row.platform || 'other',
  };
  const hit = attributePerson(person, byLeaid.get(row.leaid) ?? []);
  return hit.contact ? { ...hit.contact, person_id: `${accepted.email}|${accepted.pattern}` } : null;
}

export async function fillPatternEmails(options: {
  runDir: string;
  schools: ListedSchool[];
  live: boolean;
  dryRun: boolean;
  fixtures: boolean;
  maxRows?: number | null;
  concurrency?: number | null;
  verifyImpl?: typeof verifyEmailWithMillionVerifier;
}): Promise<{ contacts: RawSchoolContact[]; mv_calls: number; estimate: ReturnType<typeof patternEmailEstimate> }> {
  const estimate = patternEmailEstimate(options.runDir, options.maxRows ?? null);
  if (options.dryRun && !options.fixtures) {
    return { contacts: [], mv_calls: 0, estimate };
  }
  if (!options.fixtures && !options.live) {
    throw new Error(
      'Live MillionVerifier spend requires --live after explicit spend OK. Use --dry-run to print the estimate.',
    );
  }

  const contactsPath = join(options.runDir, 'directory_contacts_raw.csv');
  const scraped = existsSync(contactsPath) ? (readCsv(contactsPath) as unknown as RawSchoolContact[]) : [];
  const learned = learnDistrictPatterns(scraped);
  const sites = existsSync(join(options.runDir, 'district_sites.csv'))
    ? new Map(loadDistrictSitesCsv(join(options.runDir, 'district_sites.csv')).map((row) => [row.leaid, row]))
    : new Map<string, DistrictSite>();
  const people = loadMissingRows(options.runDir, options.maxRows ?? null);
  const byLeaid = new Map<string, ListedSchool[]>();
  const byNcessch = new Map<string, ListedSchool>();
  for (const school of options.schools) {
    const list = byLeaid.get(school.leaid) ?? [];
    list.push(school);
    byLeaid.set(school.leaid, list);
    byNcessch.set(school.ncessch, school);
  }

  const existing = loadJson<PatternEmailCheckpoint>(checkpointPath(options.runDir));
  const checkpoint: PatternEmailCheckpoint = existing ?? {
    version: 1,
    status: 'in_progress',
    next_index: 0,
    mv_calls: 0,
    results: [],
    district_pattern: Object.fromEntries(
      [...learned.entries()].filter(([, row]) => row.pattern).map(([leaid, row]) => [leaid, row.pattern]),
    ),
  };

  const verify = options.verifyImpl ?? verifyEmailWithMillionVerifier;
  const remaining = people.slice(checkpoint.next_index).map((row, offset) => ({
    row,
    index: checkpoint.next_index + offset,
  }));
  const concurrency = options.fixtures
    ? Math.max(1, remaining.length || 1)
    : Math.max(1, options.concurrency ?? LIVE_CONCURRENCY);
  const withLock = createLock();
  const pending = new Map<
    number,
    { contact: RawSchoolContact | null; calls: number; pattern: PatternKind | ''; leaid: string }
  >();
  let lastLogged = checkpoint.next_index;

  if (remaining.length > 0) {
    console.error(
      `[pattern-emails] resume=${checkpoint.next_index}/${people.length} remaining=${remaining.length} concurrency=${concurrency}`,
    );
  }

  await mapWithConcurrency(remaining, concurrency, async ({ row, index }) => {
    const domain = domainForRow(row.leaid, learned, sites);
    const guesses = orderGuesses(
      guessEmailPatterns(row.first_name, row.last_name, domain),
      checkpoint.district_pattern[row.leaid] ?? '',
    );
    let accepted: EmailPatternGuess | null = null;
    let calls = 0;
    for (const guess of guesses) {
      const result = options.fixtures
        ? {
            email: guess.email,
            result: guess.pattern === (checkpoint.district_pattern[row.leaid] || 'first.last') ? 'ok' : 'invalid',
          }
        : await verify(guess.email, { useFixtures: options.fixtures });
      calls += 1;
      if (acceptPatternResult(guess.pattern, result.result)) {
        accepted = guess;
        break;
      }
    }
    const contact = accepted ? acceptedContact(row, accepted, byNcessch, byLeaid) : null;
    await withLock(() => {
      if (accepted) checkpoint.district_pattern[row.leaid] = accepted.pattern;
      pending.set(index, {
        contact,
        calls,
        pattern: accepted?.pattern ?? '',
        leaid: row.leaid,
      });
      let advanced = false;
      while (pending.has(checkpoint.next_index)) {
        const item = pending.get(checkpoint.next_index)!;
        pending.delete(checkpoint.next_index);
        checkpoint.mv_calls += item.calls;
        if (item.pattern) checkpoint.district_pattern[item.leaid] = item.pattern;
        if (item.contact) checkpoint.results.push(item.contact);
        checkpoint.next_index += 1;
        advanced = true;
      }
      if (!advanced) return;
      saveCheckpoint(options.runDir, checkpoint);
      if (checkpoint.next_index - lastLogged >= 25 || checkpoint.next_index >= people.length) {
        lastLogged = checkpoint.next_index;
        console.error(
          `[pattern-emails] ${checkpoint.next_index}/${people.length} accepted=${checkpoint.results.length} mv=${checkpoint.mv_calls}`,
        );
      }
    });
  });

  checkpoint.status = 'completed';
  checkpoint.next_index = people.length;
  saveCheckpoint(options.runDir, checkpoint);
  return { contacts: checkpoint.results, mv_calls: checkpoint.mv_calls, estimate };
}
