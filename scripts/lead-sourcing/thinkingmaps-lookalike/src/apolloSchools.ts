import { enrichPeopleByIds } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { loadJson } from './lib/io.js';
import { sleepWithJitter, withRetry } from './lib/retry.js';
import { missingSlots } from './schoolContacts.js';
import { apolloTitlesForRoles } from './schoolRoles.js';
import type { ListedSchool, PickedSchoolContact, RawSchoolContact } from './types.js';

const SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';

export type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  organization?: { name?: string };
};

export type ApolloCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  api_calls: number;
  reveal_calls?: number;
  revealed?: boolean;
  results: RawSchoolContact[];
};

function checkpointPath(runDir: string): string {
  return join(runDir, 'apollo_checkpoint.json');
}

function saveCheckpoint(runDir: string, checkpoint: ApolloCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  mkdirSync(runDir, { recursive: true });
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

export function apolloEstimate(schools: ListedSchool[], picked: PickedSchoolContact[]): {
  schools_needing_fill: number;
  max_calls: number;
} {
  const gaps = missingSlots(schools, picked);
  return { schools_needing_fill: gaps.length, max_calls: gaps.length };
}

function fixturePeople(school: ListedSchool): ApolloPerson[] {
  const specific = join(fixturesDir, 'apollo', `people-search-${school.ncessch}.json`);
  const fallback = join(fixturesDir, 'apollo', 'people-search.json');
  const path = existsSync(specific) ? specific : fallback;
  const data = loadJson<{ people?: ApolloPerson[] }>(path);
  return data?.people ?? [];
}

async function searchPeople(options: {
  school: ListedSchool;
  titles: string[];
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<ApolloPerson[]> {
  const response = await withRetry(
    async () => {
      const res = await options.fetchImpl(SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': options.apiKey,
        },
        body: JSON.stringify({
          q_organization_name: options.school.school_name,
          person_titles: options.titles,
          person_locations: ['United States', options.school.state, options.school.city].filter(Boolean),
          include_similar_titles: true,
          page: 1,
          per_page: 15,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const err = new Error(`Apollo HTTP ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      if (!res.ok) throw new Error(`Apollo HTTP ${res.status}`);
      return res;
    },
    { maxAttempts: 4, baseDelayMs: 2000 },
  );
  const body = (await response.json()) as { people?: ApolloPerson[] };
  return body.people ?? [];
}

function toContact(school: ListedSchool, person: ApolloPerson): RawSchoolContact | null {
  const email = (person.email ?? '').trim().toLowerCase();
  const first = (person.first_name ?? '').trim();
  const last = (person.last_name ?? '').trim();
  if (!first && !last && !email) return null;
  return {
    ncessch: school.ncessch,
    leaid: school.leaid,
    school_name: school.school_name,
    first_name: first,
    last_name: last,
    title: person.title ?? '',
    email,
    linkedin_url: person.linkedin_url ?? '',
    company: person.organization?.name ?? school.school_name,
    phone: '',
    provider: 'apollo',
    email_risk: '',
    person_id: person.id || person.linkedin_url || email || `${school.ncessch}:${first}:${last}`,
  };
}

async function revealMissingEmails(options: {
  contacts: RawSchoolContact[];
  apiKey: string;
  fixtures: boolean;
  fetchImpl: typeof fetch;
}): Promise<{ contacts: RawSchoolContact[]; reveal_calls: number }> {
  const need = options.contacts.filter((row) => row.person_id && !row.email.includes('@'));
  if (need.length === 0) return { contacts: options.contacts, reveal_calls: 0 };
  const byId = new Map(need.map((row) => [row.person_id, row]));
  const ids = [...byId.keys()];
  let revealCalls = 0;
  const revealed = new Map<string, { email?: string; last_name?: string; first_name?: string; linkedin_url?: string }>();
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const people = await enrichPeopleByIds(batch, {
      apiKey: options.apiKey,
      useFixtures: options.fixtures,
      fetchImpl: options.fetchImpl,
    });
    revealCalls += batch.length;
    for (const person of people) {
      if (!person.id) continue;
      revealed.set(person.id, person);
    }
    if (!options.fixtures) await sleepWithJitter(400, 200);
  }
  const contacts = options.contacts.map((row) => {
    const person = revealed.get(row.person_id);
    if (!person) return row;
    return {
      ...row,
      email: (person.email ?? row.email).trim().toLowerCase(),
      first_name: (person.first_name ?? row.first_name).trim() || row.first_name,
      last_name: (person.last_name ?? row.last_name).trim() || row.last_name,
      linkedin_url: person.linkedin_url ?? row.linkedin_url,
    };
  });
  return { contacts, reveal_calls: revealCalls };
}

export async function fillWithApollo(options: {
  runDir: string;
  schools: ListedSchool[];
  picked: PickedSchoolContact[];
  live: boolean;
  dryRun: boolean;
  fixtures: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxRows?: number | null;
}): Promise<{
  contacts: RawSchoolContact[];
  api_calls: number;
  reveal_calls: number;
  estimate: ReturnType<typeof apolloEstimate>;
}> {
  const estimate = apolloEstimate(options.schools, options.picked);
  if (options.dryRun && !options.fixtures) {
    return { contacts: [], api_calls: 0, reveal_calls: 0, estimate };
  }
  if (!options.fixtures && !options.live) {
    throw new Error(
      'Live Apollo spend requires --live after explicit spend OK. Use --dry-run to print the estimate, or --fixtures for $0 tests.',
    );
  }

  let gaps = missingSlots(options.schools, options.picked);
  const sample = loadJson<string[]>(join(options.runDir, 'paid_sample_ncessch.json'));
  if (sample?.length && options.maxRows && options.maxRows > 0) {
    const allowed = new Set(sample);
    gaps = gaps.filter((gap) => allowed.has(gap.school.ncessch));
  } else if (options.maxRows && options.maxRows > 0) {
    gaps = gaps.slice(0, options.maxRows);
  }
  const existing = loadJson<ApolloCheckpoint>(checkpointPath(options.runDir));
  const checkpoint: ApolloCheckpoint = existing ?? {
    version: 1,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_index: 0,
    total: gaps.length,
    api_calls: 0,
    results: [],
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim() ?? '';
  if (!options.fixtures && !apiKey) throw new Error('APOLLO_API_KEY required for live Apollo search');

  for (let i = checkpoint.next_index; i < gaps.length; i++) {
    const gap = gaps[i]!;
    const titles = apolloTitlesForRoles(gap.missing);
    const people = options.fixtures
      ? fixturePeople(gap.school)
      : await searchPeople({ school: gap.school, titles, apiKey, fetchImpl });
    checkpoint.api_calls += 1;
    for (const person of people) {
      const contact = toContact(gap.school, person);
      if (contact) checkpoint.results.push(contact);
    }
    checkpoint.next_index = i + 1;
    saveCheckpoint(options.runDir, checkpoint);
    if (!options.fixtures) await sleepWithJitter(400, 200);
  }

  checkpoint.status = 'completed';
  if (!checkpoint.revealed) {
    const revealed = await revealMissingEmails({
      contacts: checkpoint.results,
      apiKey,
      fixtures: options.fixtures,
      fetchImpl,
    });
    checkpoint.results = revealed.contacts;
    checkpoint.reveal_calls = (checkpoint.reveal_calls ?? 0) + revealed.reveal_calls;
    checkpoint.revealed = true;
  }
  saveCheckpoint(options.runDir, checkpoint);
  return {
    contacts: checkpoint.results,
    api_calls: checkpoint.api_calls,
    reveal_calls: checkpoint.reveal_calls ?? 0,
    estimate,
  };
}
