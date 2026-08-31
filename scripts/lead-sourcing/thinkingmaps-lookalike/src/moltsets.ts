import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { loadJson, writeJson } from './lib/io.js';
import { withRetry, sleepWithJitter } from './lib/retry.js';
import { missingSlots } from './schoolContacts.js';
import { moltsetsTitleForRole } from './schoolRoles.js';
import { stateFullName } from './schoolNames.js';
import type { ListedSchool, PickedSchoolContact, RawSchoolContact, SchoolRole } from './types.js';

const SEARCH_URL = 'https://api.moltsets.com/api/v1/tools/search_people';
const ACCEPTABLE_RISK = new Set(['A', 'B', 'C']);

export type MoltsetsPerson = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  title?: string;
  business_email?: string;
  business_email_risk_score?: string;
  linkedin_url?: string;
  company?: { name?: string; domain?: string } | string;
};

export type MoltsetsCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  api_calls: number;
  results: RawSchoolContact[];
};

type Job = { school: ListedSchool; role: SchoolRole; title: string };

function companyName(person: MoltsetsPerson): string {
  if (typeof person.company === 'string') return person.company;
  return person.company?.name ?? '';
}

function jobsForGaps(schools: ListedSchool[], picked: PickedSchoolContact[]): Job[] {
  const jobs: Job[] = [];
  for (const gap of missingSlots(schools, picked)) {
    for (const role of gap.missing) {
      jobs.push({ school: gap.school, role, title: moltsetsTitleForRole(role) });
    }
  }
  return jobs;
}

export function moltsetsEstimate(schools: ListedSchool[], picked: PickedSchoolContact[]): {
  schools_needing_fill: number;
  max_calls: number;
  jobs: number;
} {
  const jobs = jobsForGaps(schools, picked);
  return {
    schools_needing_fill: new Set(jobs.map((job) => job.school.ncessch)).size,
    max_calls: jobs.length,
    jobs: jobs.length,
  };
}

function checkpointPath(runDir: string): string {
  return join(runDir, 'moltsets_checkpoint.json');
}

function saveCheckpoint(runDir: string, checkpoint: MoltsetsCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  mkdirSync(runDir, { recursive: true });
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function fixturePeople(school: ListedSchool, title: string): MoltsetsPerson[] {
  const safe = school.ncessch.replace(/\W/g, '');
  const specific = join(fixturesDir, 'moltsets', `${safe}-${title.replace(/\W+/g, '-').toLowerCase()}.json`);
  const fallback = join(fixturesDir, 'moltsets', 'people-search.json');
  const path = existsSync(specific) ? specific : fallback;
  const data = loadJson<{ results?: { results?: MoltsetsPerson[] } | MoltsetsPerson[]; people?: MoltsetsPerson[] }>(path);
  if (!data) return [];
  if (Array.isArray(data.people)) return data.people;
  if (Array.isArray(data.results)) return data.results;
  if (data.results && Array.isArray(data.results.results)) return data.results.results;
  return [];
}

async function searchPeople(options: {
  school: ListedSchool;
  title: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<MoltsetsPerson[]> {
  const response = await withRetry(
    async () => {
      const res = await options.fetchImpl(SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          company: options.school.school_name,
          title: options.title,
          country: 'United States',
          state: stateFullName(options.school.state),
          city: options.school.city,
          limit: 10,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const err = new Error(`MoltSets HTTP ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      if (!res.ok) throw new Error(`MoltSets HTTP ${res.status}`);
      return res;
    },
    { maxAttempts: 4, baseDelayMs: 1500 },
  );
  const body = (await response.json()) as {
    results?: { results?: MoltsetsPerson[] } | MoltsetsPerson[];
  };
  if (Array.isArray(body.results)) return body.results;
  if (body.results && Array.isArray(body.results.results)) return body.results.results;
  return [];
}

function toContact(school: ListedSchool, person: MoltsetsPerson): RawSchoolContact | null {
  const email = (person.business_email ?? '').trim().toLowerCase();
  const risk = (person.business_email_risk_score ?? '').trim().toUpperCase();
  if (email && risk && !ACCEPTABLE_RISK.has(risk)) return null;
  const first = (person.first_name ?? person.full_name?.split(/\s+/)[0] ?? '').trim();
  const last = (person.last_name ?? person.full_name?.split(/\s+/).slice(1).join(' ') ?? '').trim();
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
    company: companyName(person) || school.school_name,
    phone: '',
    provider: 'moltsets',
    email_risk: risk,
    person_id: person.linkedin_url || email || `${school.ncessch}:${first}:${last}`,
  };
}

export async function fillWithMoltsets(options: {
  runDir: string;
  schools: ListedSchool[];
  picked: PickedSchoolContact[];
  live: boolean;
  dryRun: boolean;
  fixtures: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxRows?: number | null;
}): Promise<{ contacts: RawSchoolContact[]; api_calls: number; estimate: ReturnType<typeof moltsetsEstimate> }> {
  const estimate = moltsetsEstimate(options.schools, options.picked);
  if (options.dryRun && !options.fixtures) {
    return { contacts: [], api_calls: 0, estimate };
  }
  if (!options.fixtures && !options.live) {
    throw new Error(
      'Live MoltSets spend requires --live after explicit spend OK. Use --dry-run to print the estimate, or --fixtures for $0 tests.',
    );
  }

  let jobs = jobsForGaps(options.schools, options.picked);
  if (options.maxRows && options.maxRows > 0) {
    const sample = [...new Set(jobs.map((job) => job.school.ncessch))].slice(0, options.maxRows);
    const allowed = new Set(sample);
    jobs = jobs.filter((job) => allowed.has(job.school.ncessch));
    writeJson(join(options.runDir, 'paid_sample_ncessch.json'), sample);
  }
  const existing = loadJson<MoltsetsCheckpoint>(checkpointPath(options.runDir));
  const checkpoint: MoltsetsCheckpoint = existing ?? {
    version: 1,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_index: 0,
    total: jobs.length,
    api_calls: 0,
    results: [],
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.MOLTSETS_API_KEY?.trim() ?? '';
  if (!options.fixtures && !apiKey) throw new Error('MOLTSETS_API_KEY required for live MoltSets search');

  for (let i = checkpoint.next_index; i < jobs.length; i++) {
    const job = jobs[i]!;
    const people = options.fixtures
      ? fixturePeople(job.school, job.title)
      : await searchPeople({ school: job.school, title: job.title, apiKey, fetchImpl });
    checkpoint.api_calls += 1;
    for (const person of people) {
      const contact = toContact(job.school, person);
      if (contact) checkpoint.results.push(contact);
    }
    checkpoint.next_index = i + 1;
    saveCheckpoint(options.runDir, checkpoint);
    if (!options.fixtures) await sleepWithJitter(250, 150);
  }

  checkpoint.status = 'completed';
  saveCheckpoint(options.runDir, checkpoint);
  return { contacts: checkpoint.results, api_calls: checkpoint.api_calls, estimate };
}
