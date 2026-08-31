import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { apolloEstimate, fillWithApollo } from './apolloSchools.js';
import { dropDirectoryCheckpointKeys, harvestStaffDirectories } from './directoryHarvest.js';
import { dedupeContacts } from './directoryQa.js';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { readCsv } from './lib/csv.js';
import {
  defaultMatchesCsv,
  defaultSchoolsCache,
  ensureApolloEnv,
  ensureMillionVerifierEnv,
  ensureSerperEnv,
  fixtureSchoolsCache,
  fixturesDir,
  loadEnv,
  packageRoot,
  repoRoot,
  useFixtures,
} from './lib/env.js';
import { fillPatternEmails, patternEmailEstimate } from './patternEmails.js';
import { fillWithMoltsets, moltsetsEstimate } from './moltsets.js';
import { importQuickEnrichContacts } from './quickenrich.js';
import { resolveInputCsv } from './prep.js';
import {
  districtsFromSchools,
  loadDistrictSitesCsv,
  resolveDistrictSites,
  sitesFromEmailDomains,
  writeDistrictSites,
} from './resolveDistrictSites.js';
import { probeLowDistrictSites } from './probeDistrictSites.js';
import { fillAllSchools, writeContactOutputs } from './schoolContacts.js';
import { fillStateDirectories, writeStateDirectoryBlockers } from './stateDirectories/load.js';
import { loadDistrictDomainsCsv, seedDistrictDomainsFromFurnace, writeDistrictDomains } from './seedDistrictDomains.js';
import { buildSchoolUniverse, loadListedSchools } from './schoolUniverse.js';
import type { ContactProvider, ListedSchool, RawSchoolContact } from './types.js';

function copyToTmp(runDir: string, files: string[]): void {
  const tmp = join(repoRoot, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const map: Record<string, string> = {
    'schools_in_won_districts.csv': 'thinkingmaps-won-district-schools.csv',
    'eligible_schools.csv': 'thinkingmaps-won-district-eligible-schools.csv',
    'won_school_match_review.csv': 'thinkingmaps-won-school-match-review.csv',
    'quickenrich_school_input.csv': 'thinkingmaps-quickenrich-school-input.csv',
    'district_domains.csv': 'thinkingmaps-won-district-domains.csv',
    'district_sites.csv': 'thinkingmaps-won-district-sites.csv',
    'district_site_review.csv': 'thinkingmaps-won-district-site-review.csv',
    'directory_contacts_raw.csv': 'thinkingmaps-directory-contacts-raw.csv',
    'directory_districts.csv': 'thinkingmaps-directory-districts.csv',
    'directory_coverage.csv': 'thinkingmaps-directory-coverage.csv',
    'directory_review.csv': 'thinkingmaps-directory-review.csv',
    'school_contacts.csv': 'thinkingmaps-won-district-school-contacts.csv',
    'school_contact_coverage.csv': 'thinkingmaps-won-district-school-coverage.csv',
    'school_universe_summary.json': 'thinkingmaps-won-district-school-summary.json',
    'school_contact_summary.json': 'thinkingmaps-won-district-school-contact-summary.json',
    'state_directory_raw.csv': 'thinkingmaps-state-directory-raw.csv',
    'state_directory_contacts.csv': 'thinkingmaps-state-directory-contacts.csv',
    'state_directory_people.csv': 'thinkingmaps-state-directory-people.csv',
    'state_directory_coverage.csv': 'thinkingmaps-state-directory-coverage.csv',
    'state_directory_blockers.csv': 'thinkingmaps-state-directory-blockers.csv',
    'state_directory_summary.json': 'thinkingmaps-state-directory-summary.json',
  };
  for (const file of files) {
    const src = join(runDir, file);
    const destName = map[file];
    if (!destName || !existsSync(src)) continue;
    copyFileSync(src, join(tmp, destName));
  }
}

function loadEligible(runDir: string): ListedSchool[] {
  const path = join(runDir, 'eligible_schools.csv');
  if (!existsSync(path)) throw new Error(`eligible_schools.csv missing in ${runDir}. Run --stage schools first.`);
  return loadListedSchools(path);
}

function loadExistingContacts(runDir: string): RawSchoolContact[] {
  const path = join(runDir, 'school_contacts.csv');
  if (!existsSync(path)) return [];
  return readCsv(path).map((row) => ({
    ncessch: row.ncessch,
    leaid: row.leaid,
    school_name: row.school_name,
    first_name: row.first_name,
    last_name: row.last_name,
    title: row.title,
    email: row.email,
    linkedin_url: row.linkedin_url,
    company: row.company,
    phone: row.phone,
    provider: (row.provider || 'quickenrich') as ContactProvider,
    email_risk: row.email_risk,
    person_id: row.person_id,
  }));
}

function mergeAndWrite(runDir: string, schools: ListedSchool[], contacts: RawSchoolContact[], extra?: Record<string, number | string>): ReturnType<typeof fillAllSchools> {
  const filled = fillAllSchools({ schools, contacts: dedupeContacts(contacts) });
  writeContactOutputs({
    runDir,
    schools,
    picked: filled.picked,
    coverage: filled.coverage,
    rejected: filled.rejected,
    extra,
  });
  return filled;
}

export async function runWonSchoolContacts(argv = process.argv.slice(2)): Promise<void> {
  loadEnv();
  const cli = parseCliArgs(argv);
  const fixtures = cli.fixtures || useFixtures();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  mkdirSync(runDir, { recursive: true });
  const stage = cli.stage ?? 'schools';
  const matchesPath = resolve(cli.matches ?? (fixtures ? join(runDir, 'matches.csv') : defaultMatchesCsv()));
  const schoolsPath = resolve(
    cli.schools ?? (fixtures ? fixtureSchoolsCache() : defaultSchoolsCache()),
  );
  const inputCsv = resolveInputCsv(cli.input, fixtures);

  let schools: ListedSchool[] = [];
  const contacts: RawSchoolContact[] = [];

  if (stage === 'schools' || stage === 'all') {
    if (!existsSync(matchesPath)) throw new Error(`District matches missing: ${matchesPath}`);
    if (!existsSync(schoolsPath)) throw new Error(`CCD schools missing: ${schoolsPath}`);
    if (!existsSync(inputCsv)) throw new Error(`Closed-won CSV missing: ${inputCsv}`);
    const built = buildSchoolUniverse({
      runDir,
      matchesPath,
      schoolsPath,
      closedWonCsv: inputCsv,
    });
    schools = built.eligible;
    console.error(
      `[schools] districts_schools=${built.listed.length} eligible=${built.eligible.length} excluded=${built.listed.length - built.eligible.length} review=${built.schoolMatches.filter((row) => row.needs_review).length}`,
    );
    copyToTmp(runDir, [
      'schools_in_won_districts.csv',
      'eligible_schools.csv',
      'won_school_match_review.csv',
      'quickenrich_school_input.csv',
      'school_universe_summary.json',
    ]);
  } else {
    schools = loadEligible(runDir);
    const existing = loadExistingContacts(runDir);
    if (stage === 'directories') {
      contacts.push(...existing.filter((row) => row.provider !== 'directory'));
    } else {
      contacts.push(...existing);
    }
  }

  if ((stage === 'quickenrich-import' || stage === 'all') && cli.quickenrichResult) {
    const imported = importQuickEnrichContacts(cli.quickenrichResult, schools);
    contacts.push(...imported.contacts);
    console.error(`[quickenrich] imported=${imported.contacts.length} unmatched_rows=${imported.unmatched_rows}`);
  }

  const domainPath = join(runDir, 'district_domains.csv');
  const sitePath = join(runDir, 'district_sites.csv');
  if (stage === 'resolve-sites' || stage === 'directories' || stage === 'all') {
    const domains = fixtures
      ? loadDistrictDomainsCsv(join(fixturesDir, 'district-domains.csv'))
      : existsSync(domainPath)
        ? loadDistrictDomainsCsv(domainPath)
        : await seedDistrictDomainsFromFurnace(schools);
    writeDistrictDomains(runDir, domains);

    if (stage === 'resolve-sites' || stage === 'all') {
      if (!fixtures && cli.live) await ensureSerperEnv();
      const resolved = await resolveDistrictSites({
        runDir,
        schools,
        domains,
        dryRun: cli.dryRun && !fixtures,
        live: cli.live,
        fixtures,
        maxRows: cli.maxRows,
      });
      console.error(
        `[resolve-sites] websites=${resolved.sites.filter((row) => row.website).length}/${resolved.sites.length} serper=${resolved.serper_calls}`,
      );
      copyToTmp(runDir, ['district_domains.csv', 'district_sites.csv', 'district_site_review.csv']);
      if (stage === 'resolve-sites' && cli.dryRun && !fixtures) {
        console.error(`[done] resolve-sites dry-run → ${runDir}`);
        return;
      }
    } else if (stage === 'directories' && !existsSync(sitePath)) {
      if (fixtures) {
        const resolved = await resolveDistrictSites({
          runDir,
          schools,
          domains,
          fixtures: true,
          maxRows: cli.maxRows,
        });
        console.error(`[resolve-sites] fixtures websites=${resolved.sites.filter((row) => row.website).length}`);
      } else if (cli.live) {
        await ensureSerperEnv();
        await resolveDistrictSites({
          runDir,
          schools,
          domains,
          live: true,
          maxRows: cli.maxRows,
        });
      } else {
        const seeded = sitesFromEmailDomains(districtsFromSchools(schools, domains));
        writeDistrictSites(runDir, seeded);
        console.error(
          `[resolve-sites] seed-only websites=${seeded.filter((row) => row.website).length}/${seeded.length} (pass --stage resolve-sites --live for Serper)`,
        );
      }
    }
  }

  if (stage === 'directories' || stage === 'all') {
    const domains = existsSync(domainPath)
      ? loadDistrictDomainsCsv(domainPath)
      : fixtures
        ? loadDistrictDomainsCsv(join(fixturesDir, 'district-domains.csv'))
        : [];
    const sites = existsSync(sitePath)
      ? loadDistrictSitesCsv(sitePath)
      : sitesFromEmailDomains(districtsFromSchools(schools, domains));
    let harvestSites = sites;
    if (!fixtures) {
      const probed = await probeLowDistrictSites({ sites });
      harvestSites = probed.sites;
      writeDistrictSites(runDir, harvestSites);
      const reviewPath = join(runDir, 'directory_review.csv');
      const attributionFailed = existsSync(reviewPath)
        ? [
            ...new Set(
              readCsv(reviewPath)
                .filter((row) =>
                  ['low_school_score', 'ambiguous_school', 'missing_school_hint'].includes(row.reason ?? ''),
                )
                .map((row) => row.leaid)
                .filter(Boolean),
            ),
          ]
        : [];
      const dropLeaids = [...new Set([...probed.promoted.map((row) => row.leaid), ...attributionFailed])];
      const dropped = dropDirectoryCheckpointKeys(runDir, dropLeaids);
      console.error(
        `[directories] probed_promoted=${probed.promoted.length} checkpoint_dropped=${dropped} attribution_retry=${attributionFailed.length}`,
      );
    } else {
      writeDistrictSites(runDir, harvestSites);
    }
    const harvested = await harvestStaffDirectories({
      runDir,
      schools,
      sites: harvestSites,
      domains,
      fixtures,
      maxDistricts: cli.maxRows,
      useBrowser: !fixtures,
    });
    contacts.push(...harvested.contacts);
    console.error(
      `[directories] contacts=${harvested.contacts.length} page_fetches=${harvested.page_fetches} review=${harvested.review.length}`,
    );
    copyToTmp(runDir, [
      'district_domains.csv',
      'district_sites.csv',
      'district_site_review.csv',
      'directory_contacts_raw.csv',
      'directory_districts.csv',
      'directory_coverage.csv',
      'directory_review.csv',
    ]);
  }

  let stateFailures: Array<{ state: string; message: string }> = [];
  if (stage === 'state-directories' || stage === 'all') {
    try {
      const stateFill = await fillStateDirectories({
        runDir,
        schools,
        fixtures,
        refresh: cli.refresh,
      });
      stateFailures = stateFill.failures;
      contacts.push(...stateFill.contacts);
      const cov = Object.fromEntries(stateFill.coverage.map((row) => [row.source_state, row.matched]));
      console.error(
        `[state-directories] contacts=${stateFill.contacts.length} people=${stateFill.people.length} matched=${JSON.stringify(cov)}`,
      );
      copyToTmp(runDir, [
        'state_directory_raw.csv',
        'state_directory_contacts.csv',
        'state_directory_people.csv',
        'state_directory_coverage.csv',
        'state_directory_summary.json',
        'state_directory_blockers.csv',
      ]);
    } catch (error) {
      if (fixtures) {
        console.error(`[state-directories] skipped fixtures: ${error instanceof Error ? error.message : error}`);
      } else {
        throw error;
      }
    }
  }

  let filled = { picked: [] as ReturnType<typeof fillAllSchools>['picked'], rejected: 0, coverage: [] as ReturnType<typeof fillAllSchools>['coverage'] };
  if (stage !== 'schools' || contacts.length > 0) {
    filled = mergeAndWrite(runDir, schools, contacts, {
      directory_contacts: contacts.filter((row) => row.provider === 'directory').length,
      state_agency_contacts: contacts.filter((row) => row.provider === 'state_agency').length,
      quickenrich_contacts: contacts.filter((row) => row.provider === 'quickenrich').length,
    });
  }

  if (stage === 'state-directories' || stage === 'all') {
    writeStateDirectoryBlockers({
      runDir,
      schoolCoverage: filled.coverage,
      failures: stateFailures,
    });
    copyToTmp(runDir, ['state_directory_blockers.csv']);
  }

  if (stage === 'state-directories') {
    const estimate = patternEmailEstimate(runDir);
    console.error(
      `[pattern-emails] gated. people=${estimate.people} with_pattern=${estimate.with_learned_pattern} with_domain=${estimate.with_domain} max_mv=${estimate.max_mv_calls} likely_mv=${estimate.likely_mv_calls}. Re-run with --stage pattern-emails --dry-run, then --live after spend OK.`,
    );
  }

  const runPaid = fixtures || cli.live || cli.dryRun;
  if (stage === 'pattern-emails') {
    if (!fixtures && cli.live) await ensureMillionVerifierEnv();
    const patterned = await fillPatternEmails({
      runDir,
      schools,
      live: cli.live,
      dryRun: cli.dryRun,
      fixtures,
      maxRows: cli.maxRows,
      concurrency: cli.concurrency,
    });
    console.error(
      `[pattern-emails] people=${patterned.estimate.people} with_pattern=${patterned.estimate.with_learned_pattern} with_domain=${patterned.estimate.with_domain} max_mv=${patterned.estimate.max_mv_calls} likely_mv=${patterned.estimate.likely_mv_calls} mv_calls=${patterned.mv_calls}`,
    );
    if (!cli.dryRun || fixtures) {
      contacts.push(...patterned.contacts);
      filled = mergeAndWrite(runDir, schools, contacts, { pattern_email_mv_calls: patterned.mv_calls });
    }
  }
  if (stage === 'moltsets' || (stage === 'all' && runPaid)) {
    const molt = await fillWithMoltsets({
      runDir,
      schools,
      picked: filled.picked,
      live: cli.live,
      dryRun: cli.dryRun,
      fixtures,
      maxRows: cli.maxRows,
    });
    console.error(
      `[moltsets] schools_needing_fill=${molt.estimate.schools_needing_fill} max_calls=${molt.estimate.max_calls} api_calls=${molt.api_calls}`,
    );
    if (!cli.dryRun || fixtures) {
      contacts.push(...molt.contacts);
      filled = mergeAndWrite(runDir, schools, contacts, { moltsets_calls: molt.api_calls });
    }
  } else if (stage === 'all') {
    const estimate = moltsetsEstimate(schools, filled.picked);
    console.error(
      `[moltsets] gated. schools_needing_fill=${estimate.schools_needing_fill} max_calls=${estimate.max_calls}. Re-run with --stage moltsets --dry-run, then --live after spend OK.`,
    );
  }

  if (stage === 'apollo' || (stage === 'all' && runPaid)) {
    if (!fixtures && cli.live) await ensureApolloEnv();
    const apollo = await fillWithApollo({
      runDir,
      schools,
      picked: filled.picked,
      live: cli.live,
      dryRun: cli.dryRun,
      fixtures,
      maxRows: cli.maxRows,
    });
    console.error(
      `[apollo] schools_needing_fill=${apollo.estimate.schools_needing_fill} max_calls=${apollo.estimate.max_calls} api_calls=${apollo.api_calls} reveal_calls=${apollo.reveal_calls}`,
    );
    if (!cli.dryRun || fixtures) {
      contacts.push(...apollo.contacts);
      filled = mergeAndWrite(runDir, schools, contacts, { apollo_calls: apollo.api_calls });
    }
  } else if (stage === 'all') {
    const estimate = apolloEstimate(schools, filled.picked);
    console.error(
      `[apollo] gated. schools_needing_fill=${estimate.schools_needing_fill} max_calls=${estimate.max_calls}. Re-run with --stage apollo --dry-run, then --live after spend OK.`,
    );
  }

  if (stage === 'merge') {
    filled = mergeAndWrite(runDir, schools, contacts);
  }

  if (existsSync(join(runDir, 'school_contacts.csv'))) {
    copyToTmp(runDir, ['school_contacts.csv', 'school_contact_coverage.csv', 'school_contact_summary.json']);
  }
  console.error(`[done] contacts=${filled.picked.length} eligible_schools=${schools.length} → ${runDir}`);
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/wonSchoolContacts.ts');
if (isDirect) {
  runWonSchoolContacts().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
