import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv, useFixtures } from '../lib/env.js';
import { loadIcpConfig, type IcpConfig } from '../lib/config.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { parseCliArgs } from '../lib/cli.js';
import { STAGE3_COLUMNS, STAGE4_LEAD_COLUMNS, rowToRecord, type Stage3Row, type Stage4LeadRow } from '../lib/types.js';
import { CallCounter } from '../lib/callCounter.js';
import { sleepWithJitter } from '../lib/retry.js';
import {
  enrichPeopleByIds,
  matchPersonByLinkedIn,
  searchPeopleByOrganization,
  splitName,
  type ApolloClientOptions,
  extractPersonLocation,
  type ApolloPerson,
} from '../stage3-enrich/apolloClient.js';
import { buildAuthorProfileByUrl, buildPostTextByUrl, countRejectionReasons, filterEntities } from './icpFilter.js';
import { isPosterEligible, isValidPosterContact, type ContactSlot } from './contactTier.js';
import type { SmokeConfig } from '../lib/config.js';
import {
  appendContactLog,
  assertCheckpointCompatible,
  computeStage4Stats,
  createEmptyCheckpoint,
  defaultLeadsCsvPath,
  inputFingerprint,
  loadCheckpoint,
  persistStage4State,
  type Stage4Checkpoint,
  type Stage4Stats,
} from './stage4Checkpoint.js';
import {
  buildContactLogEntry,
  logStage4Done,
  logStage4Entity,
  logStage4Start,
} from './stage4ProgressLog.js';

export type { Stage4Stats };

export const STAGE2_DEFAULT_FILENAME = 'stage2_linkedin_webinar_posts_extracted.csv';

export type Stage4Options = {
  inputPath: string;
  stage2InputPath?: string;
  outputPath?: string;
  rejectedPath?: string;
  runDir?: string;
  resumeRunDir?: string;
  dryRun?: boolean;
  counter?: CallCounter;
  useFixtures?: boolean;
  smokeLimits?: Partial<SmokeConfig>;
  /** Test-only: exit loop after N entities without marking completed. */
  stopAfterEntities?: number;
};

export type EntityContact = {
  person: ApolloPerson;
  slot: ContactSlot;
};

function resolveRunDir(
  options: Stage4Options,
  cli: ReturnType<typeof parseCliArgs>,
  inputPath: string,
): string {
  const resumeDir = options.resumeRunDir ?? cli.resume;
  if (resumeDir) return resolve(resumeDir);

  if (options.runDir ?? cli.runDir) {
    return resolve(options.runDir ?? cli.runDir!);
  }

  return resolve(dirname(inputPath));
}

function apolloPeopleCalls(counter: CallCounter): number {
  return counter.counts.apollo_people_calls;
}

export function resolveStage2InputPath(stage3InputPath: string, explicit?: string): string | null {
  if (explicit) return resolve(explicit);
  const sibling = join(dirname(resolve(stage3InputPath)), STAGE2_DEFAULT_FILENAME);
  return existsSync(sibling) ? sibling : null;
}

function personToLead(entity: Stage3Row, person: ApolloPerson, slot: ContactSlot): Stage4LeadRow {
  const { first_name, last_name } = splitName(
    `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim(),
  );
  const registrationUrl = entity.registration_urls.split('|').filter(Boolean)[0] ?? '';
  const location = extractPersonLocation(person);

  return rowToRecord({
    email: person.email!.trim().toLowerCase(),
    first_name,
    last_name,
    company_name: entity.company_name,
    website: entity.company_domain ? `https://${entity.company_domain}` : '',
    linkedin_url: person.linkedin_url ?? '',
    company_linkedin_url: entity.company_linkedin_url,
    webinar_topic: entity.webinar_topic,
    registration_url: registrationUrl,
    sample_post_url: entity.sample_post_url,
    contact_title: person.title ?? '',
    contact_tier: slot.tier,
    contact_pick_reason: slot.reason,
    employee_count: entity.employee_count,
    industry: entity.industry,
    city: location.city,
    state: location.state,
    country: location.country,
  }) as Stage4LeadRow;
}

async function resolvePosterContact(
  entity: Stage3Row,
  icpConfig: IcpConfig,
  authorProfileByUrl: Map<string, string>,
  apolloOptions: ApolloClientOptions,
): Promise<EntityContact | null> {
  if (!isPosterEligible(entity, authorProfileByUrl)) return null;

  const authorUrl = authorProfileByUrl.get(entity.sample_post_url)?.trim();
  if (!authorUrl) return null;

  let poster = await matchPersonByLinkedIn(authorUrl, apolloOptions);
  if (!poster?.id) return null;
  if (poster.organization?.id && poster.organization.id !== entity.apollo_org_id) return null;

  if (!isValidPosterContact(poster.title, icpConfig.contact_search.contact_tiers)) return null;

  if (!poster.email?.includes('@')) {
    const enriched = await enrichPeopleByIds([poster.id], apolloOptions, entity.apollo_org_id);
    poster = enriched[0] ?? poster;
  }

  if (!poster.email?.includes('@')) return null;

  return {
    person: poster,
    slot: {
      id: poster.id!,
      tier: 'poster',
      reason: 'poster:linkedin_author',
      title: poster.title,
    },
  };
}

export async function findContactsForEntity(
  entity: Stage3Row,
  icpConfig: IcpConfig,
  apolloOptions: ApolloClientOptions,
  authorProfileByUrl: Map<string, string>,
): Promise<{ contacts: EntityContact[]; orgSearches: number; posterMatches: number }> {
  const searchConfig = icpConfig.contact_search;
  const limit = searchConfig.max_contacts_per_company;
  const contacts: EntityContact[] = [];
  let orgSearches = 0;
  let posterMatches = 0;

  const posterContact = await resolvePosterContact(entity, icpConfig, authorProfileByUrl, apolloOptions);
  if (posterContact) {
    contacts.push(posterContact);
    posterMatches = 1;
  }

  const remaining = limit - contacts.length;
  if (remaining <= 0) {
    return { contacts, orgSearches, posterMatches };
  }

  const excludeIds = contacts.map((contact) => contact.person.id!).filter(Boolean);
  const { people, slots } = await searchPeopleByOrganization(
    {
      organizationId: entity.apollo_org_id,
      perPage: searchConfig.per_page,
      matchLimit: remaining,
      contactTiers: searchConfig.contact_tiers,
      excludeIds,
    },
    apolloOptions,
  );
  orgSearches = 1;

  const peopleById = new Map(people.filter((person) => person.id).map((person) => [person.id!, person]));
  for (const slot of slots) {
    const person = peopleById.get(slot.id);
    if (!person?.email?.includes('@')) continue;
    contacts.push({ person, slot });
  }

  return { contacts, orgSearches, posterMatches };
}

export function countPosterEligible(
  entities: Stage3Row[],
  authorProfileByUrl: Map<string, string>,
): number {
  return entities.filter((entity) => isPosterEligible(entity, authorProfileByUrl)).length;
}

function buildRunningStats(input: {
  entities: Stage3Row[];
  icpPassed: number;
  pipelineRejected: number;
  rejectedCount: number;
  leads: Stage4LeadRow[];
  orgSearches: number;
  posterMatches: number;
  zeroLeads: number;
  entitiesProcessed: number;
}): Stage4Stats {
  return computeStage4Stats({
    totalInputEntities: input.entities.length,
    icpPassed: input.icpPassed,
    pipelineRejected: input.pipelineRejected,
    rejected: input.rejectedCount,
    leads: input.leads,
    orgSearches: input.orgSearches,
    posterMatches: input.posterMatches,
    zeroLeads: input.zeroLeads,
    entitiesProcessed: input.entitiesProcessed,
  });
}

export async function runStage4(options: Stage4Options): Promise<{
  outputPath: string;
  rejectedPath: string;
  leads: Stage4LeadRow[];
  stats: Stage4Stats;
  interrupted?: boolean;
}> {
  await ensureEnv();
  const cli = parseCliArgs();
  const useFixtureMode = options.useFixtures ?? cli.fixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const icpConfig = loadIcpConfig();
  const inputPath = resolve(options.inputPath);
  const entities = readCsv(inputPath) as Stage3Row[];

  const stage2Path = resolveStage2InputPath(inputPath, options.stage2InputPath ?? cli.stage2Input);
  const stage2Rows = stage2Path
    ? (readCsv(stage2Path) as Array<{ result_url?: string; post_text?: string; author_profile_url?: string }>)
    : [];
  const postTextByUrl = buildPostTextByUrl(stage2Rows);
  const authorProfileByUrl = buildAuthorProfileByUrl(stage2Rows);

  const { passed, rejected } = filterEntities(entities, { icpConfig, postTextByUrl });
  const rejectionBreakdown = countRejectionReasons(rejected);
  const pipelineRejected = rejectionBreakdown.pipeline_not_plausible ?? 0;
  const posterEligible = countPosterEligible(passed, authorProfileByUrl);
  const fingerprint = inputFingerprint(inputPath, stage2Path, passed);

  if (cli.dryRun || options.dryRun) {
    console.log(
      JSON.stringify({
        stage: 4,
        dry_run: true,
        entities: entities.length,
        pipeline_passed: passed.length,
        pipeline_rejected: pipelineRejected,
        contact_eligible: passed.length,
        icp_passed: passed.length,
        rejected: rejected.length,
        rejection_breakdown: rejectionBreakdown,
        stage2_input: stage2Path,
        estimate: {
          apollo_people_calls: passed.length + posterEligible,
          org_search_entities: passed.length,
          poster_eligible_entities: posterEligible,
        },
      }),
    );
    return {
      outputPath: '',
      rejectedPath: '',
      leads: [],
      stats: buildRunningStats({
        entities,
        icpPassed: passed.length,
        pipelineRejected,
        rejectedCount: rejected.length,
        leads: [],
        orgSearches: 0,
        posterMatches: 0,
        zeroLeads: 0,
        entitiesProcessed: 0,
      }),
    };
  }

  const runDir = resolveRunDir(options, cli, inputPath);
  mkdirSync(runDir, { recursive: true });
  const outputPath = resolve(options.outputPath ?? cli.output ?? defaultLeadsCsvPath(runDir));
  const rejectedPath =
    options.rejectedPath ?? join(dirname(outputPath), 'stage4_rejected_entities.csv');
  const resumed = Boolean(options.resumeRunDir ?? cli.resume);

  const peopleSearchLimit = options.smokeLimits?.max_apollo_people_searches;
  const entitiesToSearch = peopleSearchLimit ? passed.slice(0, peopleSearchLimit) : passed;

  let checkpoint: Stage4Checkpoint;
  if (resumed) {
    checkpoint = loadCheckpoint(runDir);
    assertCheckpointCompatible(checkpoint, inputPath, stage2Path, fingerprint);
    counter.counts = { ...checkpoint.api_calls };
  } else {
    checkpoint = createEmptyCheckpoint({
      inputPath,
      stage2InputPath: stage2Path,
      inputFingerprint: fingerprint,
      outputPath,
      rejectedPath,
      totalEntities: entitiesToSearch.length,
      totalInputEntities: entities.length,
      icpPassed: passed.length,
      pipelineRejected,
      rejected: rejected.length,
    });
    persistStage4State(runDir, checkpoint, [], outputPath);
  }

  writeCsv(
    rejectedPath,
    rejected.map((r) => rowToRecord(r)),
    [...STAGE3_COLUMNS, 'rejection_reason'],
  );

  let leads: Stage4LeadRow[] = [...checkpoint.leads];
  const seenEmails = new Set<string>(checkpoint.seen_emails);
  let orgSearches = checkpoint.stats.org_searches;
  let posterMatches = checkpoint.stats.poster_matches;
  let zeroLeads = checkpoint.stats.zero_leads;
  let startIndex = checkpoint.next_entity_index;
  let interrupted = false;

  const onSignal = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  logStage4Start({
    runDir,
    inputPath,
    stage2InputPath: stage2Path,
    resumed,
    totalEntities: entitiesToSearch.length,
    startingEntity: startIndex,
    icpRejected: rejected.length,
    startingApolloCalls: apolloPeopleCalls(counter),
  });

  const apolloOptions = { useFixtures: useFixtureMode, counter };

  for (let i = startIndex; i < entitiesToSearch.length; i++) {
    if (interrupted) break;

    const entity = entitiesToSearch[i]!;
    let leadsAdded = 0;
    let entityPosterMatches = 0;
    let contactTiers: string[] = [];
    let errorMessage: string | undefined;

    try {
      const result = await findContactsForEntity(entity, icpConfig, apolloOptions, authorProfileByUrl);
      orgSearches += result.orgSearches;
      entityPosterMatches = result.posterMatches;
      posterMatches += result.posterMatches;

      for (const contact of result.contacts) {
        const email = contact.person.email?.trim().toLowerCase() ?? '';
        if (!email || seenEmails.has(email)) continue;
        seenEmails.add(email);
        leads.push(personToLead(entity, contact.person, contact.slot));
        leadsAdded++;
        contactTiers.push(contact.slot.tier);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    if (leadsAdded === 0 && !errorMessage) {
      zeroLeads++;
    }

    const entitiesProcessed = i + 1;
    const stats = buildRunningStats({
      entities,
      icpPassed: passed.length,
      pipelineRejected,
      rejectedCount: rejected.length,
      leads,
      orgSearches,
      posterMatches,
      zeroLeads,
      entitiesProcessed,
    });

    checkpoint.next_entity_index = i + 1;
    checkpoint.api_calls = counter.snapshot();
    checkpoint.stats = stats;
    checkpoint.seen_emails = [...seenEmails];
    persistStage4State(runDir, checkpoint, leads, outputPath);

    const logEntry = buildContactLogEntry({
      entityIndex: i,
      companyName: entity.company_name,
      apolloOrgId: entity.apollo_org_id,
      leadsAdded,
      contactTiers,
      posterMatch: entityPosterMatches > 0,
      zeroLead: leadsAdded === 0 && !errorMessage,
      error: errorMessage,
      stats,
      apiCalls: counter.snapshot(),
    });
    appendContactLog(runDir, logEntry);
    console.log(JSON.stringify({ stage4_entity: logEntry }));

    const done = i + 1;
    if (done === 1 || done === entitiesToSearch.length || done % 25 === 0) {
      logStage4Entity({
        done,
        total: entitiesToSearch.length,
        stats,
        apolloCalls: apolloPeopleCalls(counter),
        lastCompany: entity.company_name,
      });
    }

    if (options.stopAfterEntities != null && done >= options.stopAfterEntities) {
      break;
    }

    if (!useFixtureMode) await sleepWithJitter(1000, 200);
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  if (!interrupted && checkpoint.next_entity_index >= entitiesToSearch.length) {
    checkpoint.status = 'completed';
    persistStage4State(runDir, checkpoint, leads, outputPath);
  }

  const stats = buildRunningStats({
    entities,
    icpPassed: passed.length,
    pipelineRejected,
    rejectedCount: rejected.length,
    leads,
    orgSearches,
    posterMatches,
    zeroLeads,
    entitiesProcessed: checkpoint.next_entity_index,
  });

  logStage4Done({
    interrupted,
    total: entitiesToSearch.length,
    stats,
    apolloCalls: apolloPeopleCalls(counter),
    runDir,
    inputPath,
    stage2InputPath: stage2Path,
    outputPath,
  });

  console.log(
    JSON.stringify({
      stage: 4,
      resumed,
      interrupted,
      ...stats,
      output: outputPath,
      rejected: rejectedPath,
      api_calls: counter.snapshot(),
    }),
  );

  if (interrupted) {
    process.exitCode = 130;
  }

  return { outputPath, rejectedPath, leads, stats, interrupted };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const cli = parseCliArgs();
  if (!cli.input) {
    console.error(
      'Usage: npm run stage4 -- --input path/to/stage3.csv [--stage2-input path/to/stage2.csv] [--resume runDir]',
    );
    process.exit(1);
  }
  runStage4({
    inputPath: cli.input,
    stage2InputPath: cli.stage2Input,
    outputPath: cli.output,
    resumeRunDir: cli.resume,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
