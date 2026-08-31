import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { harvestApptegy } from './adapters/apptegy.js';
import { harvestEdlio } from './adapters/edlio.js';
import { harvestFinalsite } from './adapters/finalsite.js';
import { harvestGeneric } from './adapters/generic.js';
import type { AdapterResult, HarvestedPerson, PageClient } from './adapters/types.js';
import {
  createFixturePageClient,
  createHttpPageClient,
  createHybridPageClient,
  createPlaywrightPageClient,
  dumpLowYield,
} from './directoryBrowser.js';
import { dedupeContacts, emptyCoverage, qaPerson, type DirectoryCoverage } from './directoryQa.js';
import { rowToRecord, writeCsv } from './lib/csv.js';
import { loadJson, writeJson } from './lib/io.js';
import { HostGate, mapWithConcurrency } from './lib/pool.js';
import { originOf } from './lib/url.js';
import { detectPlatform, type PlatformId } from './platformDetect.js';
import {
  districtsFromSchools,
  isJunkHost,
  sitesFromEmailDomains,
  type DistrictSite,
} from './resolveDistrictSites.js';
import { attributePerson } from './schoolAttribution.js';
import { classifySchoolRole } from './schoolRoles.js';
import type { DistrictDomain } from './seedDistrictDomains.js';
import type { ListedSchool, RawSchoolContact } from './types.js';

export type DirectoryCheckpoint = {
  version: 2;
  status: 'in_progress' | 'completed';
  next_index: number;
  page_fetches: number;
  results: Record<string, DistrictHarvest>;
};

type DistrictHarvest = {
  leaid: string;
  website: string;
  platform: PlatformId;
  directory_urls: string[];
  contacts: RawSchoolContact[];
  review: Array<Record<string, string>>;
  unmatched: number;
  coverage: DirectoryCoverage;
  notes: string;
};

const COVERAGE_COLUMNS = [
  'leaid',
  'lea_name',
  'website',
  'platform',
  'pages',
  'people_found',
  'qa_kept',
  'attributed',
  'review',
  'schools_in_district',
  'schools_covered',
  'curriculum',
  'assistant_principal',
  'principal',
  'notes',
] as const;

const REVIEW_COLUMNS = [
  'leaid',
  'first_name',
  'last_name',
  'title',
  'email',
  'school_hint',
  'source_url',
  'reason',
  'platform',
] as const;

function checkpointPath(runDir: string): string {
  return join(runDir, 'directory_checkpoint.json');
}

function saveCheckpoint(runDir: string, checkpoint: DirectoryCheckpoint): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

export function dropDirectoryCheckpointKeys(runDir: string, leaids: string[]): number {
  const existing = loadJson<DirectoryCheckpoint>(checkpointPath(runDir));
  if (!existing?.results) return 0;
  let dropped = 0;
  for (const leaid of leaids) {
    if (existing.results[leaid]) {
      delete existing.results[leaid];
      dropped += 1;
    }
  }
  if (dropped > 0) {
    existing.status = 'in_progress';
    saveCheckpoint(runDir, existing);
  }
  return dropped;
}

function adapterFoundDirectory(result: AdapterResult): boolean {
  return (
    result.people.length > 0 ||
    result.notes.some(
      (note) =>
        note.startsWith('truncated:') ||
        note.startsWith('emails:') ||
        note.startsWith('apis:') ||
        note.startsWith('staff_urls:'),
    )
  );
}

async function runAdapter(platform: PlatformId, ctx: Parameters<typeof harvestGeneric>[0]): Promise<AdapterResult> {
  if (platform === 'finalsite') {
    const primary = await harvestFinalsite(ctx);
    if (adapterFoundDirectory(primary)) return primary;
    const fallback = await harvestGeneric(ctx);
    return {
      ...fallback,
      people: [...primary.people, ...fallback.people],
      pages: primary.pages + fallback.pages,
      directoryUrls: [...primary.directoryUrls, ...fallback.directoryUrls],
      notes: [...primary.notes, 'fallback:generic', ...fallback.notes],
    };
  }
  if (platform === 'apptegy') {
    const primary = await harvestApptegy(ctx);
    if (adapterFoundDirectory(primary) && primary.people.length > 0) return primary;
    if (primary.people.length === 0) {
      const fallback = await harvestGeneric(ctx);
      return {
        ...fallback,
        people: [...primary.people, ...fallback.people],
        pages: primary.pages + fallback.pages,
        directoryUrls: [...primary.directoryUrls, ...fallback.directoryUrls],
        notes: [...primary.notes, 'fallback:generic', ...fallback.notes],
        xhrEndpoints: [...primary.xhrEndpoints, ...fallback.xhrEndpoints],
      };
    }
    return primary;
  }
  if (platform === 'edlio') {
    const primary = await harvestEdlio(ctx);
    const emails = primary.people.filter((row) => row.email.includes('@')).length;
    if (emails === 0) {
      const finalsite = await harvestFinalsite(ctx);
      if (finalsite.people.some((row) => row.email.includes('@')) || adapterFoundDirectory(finalsite)) {
        return {
          people: [...primary.people.filter((row) => row.email.includes('@')), ...finalsite.people],
          pages: primary.pages + finalsite.pages,
          directoryUrls: [...primary.directoryUrls, ...finalsite.directoryUrls],
          notes: [...primary.notes, 'fallback:finalsite', ...finalsite.notes],
          xhrEndpoints: [...primary.xhrEndpoints, ...finalsite.xhrEndpoints],
        };
      }
    }
    if (adapterFoundDirectory(primary) && primary.people.length > 0) return primary;
    const fallback = await harvestGeneric(ctx);
    return {
      ...fallback,
      people: [...primary.people, ...fallback.people],
      pages: primary.pages + fallback.pages,
      directoryUrls: [...primary.directoryUrls, ...fallback.directoryUrls],
      notes: [...primary.notes, 'fallback:generic', ...fallback.notes],
    };
  }
  return harvestGeneric(ctx);
}

function extraDomainsFor(site: DistrictSite): string[] {
  return [site.host, site.email_domain].filter(Boolean);
}

async function harvestOneDistrict(options: {
  site: DistrictSite;
  schools: ListedSchool[];
  client: PageClient;
  maxPages: number;
  runDir: string;
}): Promise<DistrictHarvest> {
  const schools = options.schools;
  if (!options.site.website) {
    return {
      leaid: options.site.leaid,
      website: '',
      platform: 'other',
      directory_urls: [],
      contacts: [],
      review: [],
      unmatched: 0,
      coverage: emptyCoverage({
        leaid: options.site.leaid,
        lea_name: options.site.lea_name,
        notes: 'no_website',
      }),
      notes: 'no_website',
    };
  }
  const home = await options.client.fetch(options.site.website);
  const platform = detectPlatform(home.html, home.finalUrl || options.site.website);
  const adapter = await runAdapter(platform, {
    client: options.client,
    website: options.site.website,
    origin: originOf(home.finalUrl || options.site.website),
    schools,
    maxPages: platform === 'apptegy' ? Math.max(options.maxPages, 400) : options.maxPages,
    platform,
  });

  const review: Array<Record<string, string>> = [];
  const attributed: RawSchoolContact[] = [];
  let qaKept = 0;
  const seenPeople = new Set<string>();
  const uniquePeople: HarvestedPerson[] = [];
  for (const person of adapter.people) {
    const key = person.email.includes('@')
      ? person.email.toLowerCase()
      : `${person.first_name}|${person.last_name}|${person.title}|${person.school_hint}`.toLowerCase();
    if (!key.trim() || seenPeople.has(key)) continue;
    seenPeople.add(key);
    uniquePeople.push(person);
  }

  for (const person of uniquePeople) {
    const qa = qaPerson(person, { siteHost: options.site.host, extraDomains: extraDomainsFor(options.site) });
    if (!qa.ok) {
      review.push({
        leaid: options.site.leaid,
        first_name: person.first_name,
        last_name: person.last_name,
        title: person.title,
        email: person.email,
        school_hint: person.school_hint,
        source_url: person.source_url,
        reason: qa.reason,
        platform: person.platform,
      });
      continue;
    }
    qaKept += 1;
    const hit = attributePerson(person, schools);
    if (!hit.contact) {
      review.push({
        leaid: options.site.leaid,
        first_name: person.first_name,
        last_name: person.last_name,
        title: person.title,
        email: person.email,
        school_hint: person.school_hint,
        source_url: person.source_url,
        reason: hit.review_reason,
        platform: person.platform,
      });
      continue;
    }
    attributed.push(hit.contact);
  }

  const contacts = dedupeContacts(attributed);
  const covered = new Set(contacts.map((row) => row.ncessch));
  const roleCounts = { curriculum: 0, assistant_principal: 0, principal: 0 };
  for (const row of contacts) {
    const role = classifySchoolRole(row.title);
    if (role === 'curriculum' || role === 'assistant_principal' || role === 'principal') roleCounts[role] += 1;
  }
  const coverage = emptyCoverage({
    leaid: options.site.leaid,
    lea_name: options.site.lea_name,
    website: options.site.website,
    platform,
    pages: adapter.pages,
    people_found: uniquePeople.length,
    qa_kept: qaKept,
    attributed: contacts.length,
    review: review.length,
    schools_in_district: schools.length,
    schools_covered: covered.size,
    ...roleCounts,
    notes: adapter.notes.join('|'),
  });

  if (contacts.length < 3 && home.html) {
    await dumpLowYield({ runDir: options.runDir, leaid: options.site.leaid, html: home.html });
  }

  return {
    leaid: options.site.leaid,
    website: options.site.website,
    platform,
    directory_urls: adapter.directoryUrls,
    contacts,
    review,
    unmatched: review.length,
    coverage,
    notes: adapter.notes.join('|'),
    xhr: adapter.xhrEndpoints,
  } as DistrictHarvest & { xhr?: AdapterResult['xhrEndpoints'] };
}

export async function harvestStaffDirectories(options: {
  runDir: string;
  schools: ListedSchool[];
  sites?: DistrictSite[];
  domains?: DistrictDomain[];
  fixtures?: boolean;
  maxDistricts?: number | null;
  useBrowser?: boolean;
}): Promise<{
  contacts: RawSchoolContact[];
  districts: number;
  page_fetches: number;
  review: Array<Record<string, string>>;
  coverage: DirectoryCoverage[];
}> {
  const byLeaid = new Map<string, ListedSchool[]>();
  for (const school of options.schools) {
    const list = byLeaid.get(school.leaid) ?? [];
    list.push(school);
    byLeaid.set(school.leaid, list);
  }

  const sites = (options.sites ?? sitesFromEmailDomains(districtsFromSchools(options.schools, options.domains ?? [])))
    .filter(
      (row) =>
        byLeaid.has(row.leaid) &&
        row.website &&
        (row.confidence === 'high' || row.confidence === 'medium') &&
        !isJunkHost(row.host),
    );
  const districts = options.maxDistricts ? sites.slice(0, options.maxDistricts) : sites;

  const existing = loadJson<DirectoryCheckpoint>(checkpointPath(options.runDir));
  const checkpoint: DirectoryCheckpoint =
    existing && existing.version === 2
      ? existing
      : { version: 2, status: 'in_progress', next_index: 0, page_fetches: 0, results: {} };

  const cacheDir = join(options.runDir, 'html-cache');
  const hostGate = new HostGate(options.fixtures ? 0 : 80, options.fixtures ? 1 : 3);
  let close = async () => {};
  let client: PageClient;
  if (options.fixtures) {
    client = createFixturePageClient();
  } else if (options.useBrowser === false) {
    client = createHttpPageClient({ cacheDir, hostGate });
  } else {
    const http = createHttpPageClient({ cacheDir, hostGate });
    try {
      const browser = await createPlaywrightPageClient({
        cacheDir,
        hostGate,
        userDataDir: join(options.runDir, '.chrome-directory'),
      });
      client = createHybridPageClient(http, browser.client, cacheDir);
      close = browser.close;
    } catch (error) {
      console.error(`[directories] playwright unavailable (${error instanceof Error ? error.message : error}); using HTTP`);
      client = http;
    }
  }

  const xhrEndpoints: Array<{ platform: string; url: string; leaid: string }> = [];
  const pending = districts
    .map((site, index) => ({ site, index }))
    .filter((row) => !checkpoint.results[row.site.leaid]);
  try {
    await mapWithConcurrency(pending, options.fixtures ? 1 : 3, async ({ site, index }) => {
      try {
        const harvest = (await harvestOneDistrict({
          site,
          schools: byLeaid.get(site.leaid) ?? [],
          client: {
            async fetch(url: string) {
              checkpoint.page_fetches += 1;
              return client.fetch(url);
            },
            async openProfile(listingUrl: string, constituentId: string) {
              checkpoint.page_fetches += 1;
              if (!client.openProfile) {
                return { url: listingUrl, finalUrl: listingUrl, status: 404, html: '', jsonTaps: [] };
              }
              return client.openProfile(listingUrl, constituentId);
            },
          },
          maxPages: 128,
          runDir: options.runDir,
        })) as DistrictHarvest & { xhr?: AdapterResult['xhrEndpoints'] };
        for (const row of harvest.xhr ?? []) {
          xhrEndpoints.push({ ...row, leaid: site.leaid });
        }
        checkpoint.results[site.leaid] = harvest;
        checkpoint.next_index = Math.max(checkpoint.next_index, index + 1);
        saveCheckpoint(options.runDir, checkpoint);
        console.error(
          `[directory] ${index + 1}/${districts.length} ${site.host || site.leaid} platform=${harvest.platform} contacts=${harvest.contacts.length} review=${harvest.unmatched} ${harvest.notes}`,
        );
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 160);
        console.error(`[directory] ${index + 1}/${districts.length} ${site.host || site.leaid} error=${message}`);
        checkpoint.results[site.leaid] = {
          leaid: site.leaid,
          website: site.website,
          platform: 'other',
          directory_urls: [],
          contacts: [],
          review: [],
          unmatched: 0,
          coverage: emptyCoverage({
            leaid: site.leaid,
            lea_name: site.lea_name,
            website: site.website,
            notes: `error:${message}`,
          }),
          notes: `error:${message}`,
        };
        saveCheckpoint(options.runDir, checkpoint);
      }
    });
  } finally {
    await close();
  }

  checkpoint.status = 'completed';
  saveCheckpoint(options.runDir, checkpoint);

  const harvests = Object.values(checkpoint.results);
  const contacts = harvests.flatMap((row) => row.contacts);
  const review = harvests.flatMap((row) => row.review);
  const coverage = harvests.map((row) => row.coverage);

  writeCsv(
    join(options.runDir, 'directory_contacts_raw.csv'),
    contacts.map((row) => rowToRecord(row)),
    [
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
    ],
  );
  writeCsv(join(options.runDir, 'directory_review.csv'), review, REVIEW_COLUMNS);
  writeCsv(
    join(options.runDir, 'directory_coverage.csv'),
    coverage.map((row) => rowToRecord(row)),
    COVERAGE_COLUMNS,
  );
  writeCsv(
    join(options.runDir, 'directory_districts.csv'),
    harvests.map((row) =>
      rowToRecord({
        leaid: row.leaid,
        website: row.website,
        platform: row.platform,
        directory_urls: row.directory_urls.join('|'),
        contacts: row.contacts.length,
        unmatched: row.unmatched,
        notes: row.notes,
      }),
    ),
    ['leaid', 'website', 'platform', 'directory_urls', 'contacts', 'unmatched', 'notes'],
  );
  const existingEndpoints = loadJson<Array<{ platform: string; url: string; leaid: string }>>(
    join(options.runDir, 'platform-endpoints.json'),
  ) ?? [];
  writeJson(join(options.runDir, 'platform-endpoints.json'), [...existingEndpoints, ...xhrEndpoints]);
  return { contacts, districts: districts.length, page_fetches: checkpoint.page_fetches, review, coverage };
}
