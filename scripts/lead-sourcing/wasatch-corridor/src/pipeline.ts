import { join } from 'node:path';
import { acquireApollo } from './acquire/apolloSearch.js';
import { acquireEpa } from './acquire/epaFrs.js';
import { acquireFsq } from './acquire/fsqOs.js';
import { QUERY_COUNTIES, normalizePlaceName, placeInCounty, type QueryCounty } from '../config/geography.js';
import { estimateApolloSearchPages, listApolloShards } from './acquire/shards.js';
import { scoreAndExport } from './doors/export.js';
import { applyClassify, classifyCompany, classifyFieldsComplete } from './enrich/classify.js';
import { crawlCompany } from './enrich/crawl.js';
import { applyGtmSignals } from './enrich/gtm.js';
import { verifyHq } from './enrich/hqVerify.js';
import { searchCompanyPeople } from './enrich/peopleSearch.js';
import { enrichOrganizations } from './enrich/orgEnrich.js';
import { applyWebinar, extractWebinarSignals } from './enrich/webinar.js';
import { ensureEnv } from './lib/env.js';
import { writeJson } from './lib/io.js';
import { readJsonl, writeJsonl } from './lib/jsonl.js';
import { runPool } from './lib/pool.js';
import { RequestGate } from './lib/retry.js';
import { requireLiveForPaid, type CliOptions } from './lib/cli.js';
import type { CompanyRecord, PipelineContext, RawHit, ReviewRow } from './types.js';
import { admitUniverse } from './universe/admit.js';
import { dedupeCompanies } from './universe/dedupe.js';
import { hitToCompany } from './universe/normalize.js';

export function parseCounty(value: string): QueryCounty | null {
  const county = value.trim();
  if (!county) return null;
  if ((QUERY_COUNTIES as readonly string[]).includes(county)) return county as QueryCounty;
  throw new Error(`Unknown --county ${county}. Use utah, salt_lake, or davis.`);
}

export function matchesCounty(company: Pick<CompanyRecord, 'city' | 'query_city'>, county: QueryCounty): boolean {
  return placeInCounty(company.city, county) || placeInCounty(company.query_city, county);
}

export function matchesCities(company: Pick<CompanyRecord, 'city' | 'query_city'>, cities: string[]): boolean {
  if (!cities.length) return true;
  const places = [company.city, company.query_city].map((p) => normalizePlaceName(p));
  return cities.some((city) => places.includes(normalizePlaceName(city)));
}

export function ctxFromCli(runDir: string, cli: CliOptions, fixtures: boolean): PipelineContext {
  return {
    runDir,
    cacheRoot: join(runDir, 'cache'),
    fixtures,
    dryRun: cli.dryRun,
    live: cli.live,
    maxRows: cli.maxRows,
    maxApolloCalls: cli.maxApolloCalls,
    cities: cli.cities,
    bands: cli.bands,
    skipFsq: cli.skipFsq,
    skipEpa: cli.skipEpa,
    skipPeople: cli.skipPeople,
    skipGeo: cli.skipGeo,
    county: cli.county,
    fsqExtract: cli.fsqExtract,
    maxOrgEnrich: cli.maxOrgEnrich,
  };
}

export function shardFilterFromCtx(ctx: PipelineContext) {
  return { cities: ctx.cities, bands: ctx.bands };
}

export function printWaveAEstimate(ctx?: PipelineContext): void {
  const shards = listApolloShards(ctx ? shardFilterFromCtx(ctx) : {});
  const est = estimateApolloSearchPages(shards.length);
  const payload = {
    wave: 'A',
    vendor: 'Apollo mixed_companies/search',
    shards: est.shards,
    estimated_credits_low: est.estimated_credits_low,
    estimated_credits_high: est.estimated_credits_high,
    fsq_os_places: ctx?.skipFsq ? 'skipped (pilot)' : '$0 extract (token or --fsq-extract)',
    epa_frs: ctx?.skipEpa ? 'skipped (pilot)' : '$0 county download',
    census: '$0',
    cities: ctx?.cities ?? [],
    bands: ctx?.bands ?? [],
    max_apollo_calls: ctx?.maxApolloCalls ?? null,
    note: 'No live Apollo until --live after explicit spend OK.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

export function printWaveBEstimate(n: number, skipPeople = false): void {
  const payload = {
    wave: 'B',
    admitted_companies: n,
    apollo_people_searches_max: skipPeople ? 0 : n * 2,
    openrouter_classify: n,
    openrouter_webinar_purpose: 'only if webinar signals',
    skip_people: skipPeople,
    note: 'No live people/LLM until --live after explicit spend OK for this wave.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

export function printOrgEnrichEstimate(n: number, maxOrgEnrich: number | null): void {
  const capped = maxOrgEnrich != null ? Math.min(n, maxOrgEnrich) : n;
  const payload = {
    wave: 'org-enrich',
    vendor: 'Apollo organizations/enrich',
    companies: n,
    max_billable_calls: capped,
    census_readmit: '$0',
    max_org_enrich: maxOrgEnrich,
    note: 'Search-page cap (--pilot 12 / --max-apollo-calls) does not apply. No live enrich until --live after explicit spend OK.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

export async function runAcquire(ctx: PipelineContext): Promise<RawHit[]> {
  if (ctx.dryRun && !ctx.fixtures) {
    printWaveAEstimate(ctx);
    writeJson(join(ctx.runDir, 'universe', 'acquire_dry_run.json'), estimateApolloSearchPages(listApolloShards(shardFilterFromCtx(ctx)).length));
    return [];
  }
  if (!ctx.fixtures) {
    requireLiveForPaid({ live: ctx.live, dryRun: ctx.dryRun, fixtures: ctx.fixtures, vendor: 'Apollo' });
    await ensureEnv({ apollo: true });
  }
  const apollo = await acquireApollo(ctx);
  const fsq = ctx.skipFsq ? { hits: [] as RawHit[] } : await acquireFsq(ctx);
  const epa = ctx.skipEpa ? { hits: [] as RawHit[] } : await acquireEpa(ctx);
  const hits = [...apollo.hits, ...fsq.hits, ...epa.hits];
  writeJsonl(join(ctx.runDir, 'universe', 'raw.jsonl'), hits);
  writeJson(join(ctx.runDir, 'universe', 'acquire_summary.json'), {
    apollo: apollo.hits.length,
    apollo_pages: apollo.pagesFetched,
    apollo_from_cache: apollo.fromCache,
    fsq: fsq.hits.length,
    epa: epa.hits.length,
    shards: listApolloShards(shardFilterFromCtx(ctx)).length,
  });
  return hits;
}

export async function runAdmit(ctx: PipelineContext, hits?: RawHit[]): Promise<{
  admitted: CompanyRecord[];
  review: ReviewRow[];
  excluded: CompanyRecord[];
}> {
  const raw = hits ?? readJsonl<RawHit>(join(ctx.runDir, 'universe', 'raw.jsonl'));
  const companies = dedupeCompanies(raw.map(hitToCompany));
  writeJsonl(join(ctx.runDir, 'universe', 'normalized.jsonl'), companies);
  const result = await admitUniverse(ctx, companies);
  writeJson(join(ctx.runDir, 'universe', 'admit_summary.json'), {
    admitted: result.admitted.length,
    review: result.review.length,
    excluded: result.excluded.length,
  });
  return result;
}

export async function runOrgEnrich(ctx: PipelineContext, companies?: CompanyRecord[]): Promise<{
  admitted: CompanyRecord[];
  review: ReviewRow[];
  excluded: CompanyRecord[];
  liveCalls: number;
  fromCache: number;
}> {
  const rows =
    companies ??
    (() => {
      const enriched = readJsonl<CompanyRecord>(join(ctx.runDir, 'enrichment', 'companies.jsonl'));
      if (enriched.length) return enriched;
      return readJsonl<CompanyRecord>(join(ctx.runDir, 'universe', 'admitted.jsonl'));
    })();
  let work = rows;
  if (ctx.maxRows != null) work = work.slice(0, ctx.maxRows);

  if (ctx.dryRun && !ctx.fixtures) {
    printOrgEnrichEstimate(work.length, ctx.maxOrgEnrich);
    writeJson(join(ctx.runDir, 'enrichment', 'org_enrich_dry_run.json'), {
      companies: work.length,
      max_org_enrich: ctx.maxOrgEnrich,
    });
    return { admitted: work, review: [], excluded: [], liveCalls: 0, fromCache: 0 };
  }
  if (!ctx.fixtures) {
    requireLiveForPaid({
      live: ctx.live,
      dryRun: ctx.dryRun,
      fixtures: ctx.fixtures,
      vendor: 'Apollo organizations/enrich',
    });
    await ensureEnv({ apollo: true });
  }

  const result = await enrichOrganizations(ctx, work);
  writeJsonl(join(ctx.runDir, 'enrichment', 'companies.jsonl'), result.companies);
  writeJson(join(ctx.runDir, 'enrichment', 'org_enrich_summary.json'), {
    companies: result.companies.length,
    live_calls: result.liveCalls,
    from_cache: result.fromCache,
    skipped: result.skipped,
    streets: result.companies.filter((c) => Boolean(c.street)).length,
    employees: result.companies.filter((c) => c.employees != null).length,
  });
  console.error(
    `[org-enrich] live=${result.liveCalls} cache=${result.fromCache} companies=${result.companies.length} employees=${result.companies.filter((c) => c.employees != null).length}`,
  );
  return {
    admitted: result.companies,
    review: readJsonl<ReviewRow>(join(ctx.runDir, 'universe', 'review.jsonl')),
    excluded: [],
    liveCalls: result.liveCalls,
    fromCache: result.fromCache,
  };
}

export async function runEnrich(ctx: PipelineContext, admitted?: CompanyRecord[]): Promise<CompanyRecord[]> {
  let companies = admitted ?? readJsonl<CompanyRecord>(join(ctx.runDir, 'universe', 'admitted.jsonl'));
  const county = parseCounty(ctx.county);
  if (county) companies = companies.filter((c) => matchesCounty(c, county));
  if (ctx.cities.length) companies = companies.filter((c) => matchesCities(c, ctx.cities));
  if (ctx.maxRows != null) companies = companies.slice(0, ctx.maxRows);

  if (ctx.dryRun && !ctx.fixtures) {
    printWaveBEstimate(companies.length, ctx.skipPeople);
    writeJson(join(ctx.runDir, 'enrichment', 'enrich_dry_run.json'), { admitted: companies.length });
    return companies;
  }
  if (!ctx.fixtures) {
    requireLiveForPaid({
      live: ctx.live,
      dryRun: ctx.dryRun,
      fixtures: ctx.fixtures,
      vendor: ctx.skipPeople ? 'OpenRouter' : 'Apollo people + OpenRouter',
    });
    await ensureEnv({ apollo: !ctx.skipPeople, openrouter: true });
  }

  const outPath = join(ctx.runDir, 'enrichment', 'companies.jsonl');
  const existing = readJsonl<CompanyRecord>(join(ctx.runDir, 'enrichment', 'companies.jsonl'));
  const byId = new Map(existing.map((c) => [c.company_id, c]));
  const peopleGate = new RequestGate(150, 6);
  const work: CompanyRecord[] = [];
  let skipped = 0;

  for (const incoming of companies) {
    const company = byId.get(incoming.company_id)
      ?? [...byId.values()].find((c) => Boolean(c.domain) && c.domain === incoming.domain)
      ?? incoming;
    const alreadyClassified = classifyFieldsComplete({
      b2b_type: company.b2b_type,
      primary_buyer: company.primary_buyer,
      customer_geo: company.customer_geo,
      what_they_sell: company.what_they_sell,
      category: company.category,
      target_audience: company.target_audience,
      is_outbound_shop: company.is_outbound_shop,
      has_sales_motion: company.has_sales_motion,
    });
    byId.set(company.company_id, company);
    if (alreadyClassified) skipped += 1;
    else work.push(company);
  }
  console.error(`[enrich] ${work.length} to classify, ${skipped} already done, concurrency 8`);

  let completed = 0;
  await runPool(work, 8, async (company) => {
    console.error(`[enrich] ${company.name} (${company.domain ?? 'no-domain'})`);
    try {
      const site = await crawlCompany(ctx, company);
      const people = ctx.skipPeople ? [] : await searchCompanyPeople(ctx, peopleGate, company);
      applyGtmSignals(company, people, site.pages.map((p) => p.text).join('\n'));
      const classified = await classifyCompany(ctx, company, site);
      applyClassify(company, classified);
      const webinar = await extractWebinarSignals(ctx, company, site);
      applyWebinar(company, webinar);
      verifyHq(company, site);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[enrich] failed ${company.name}: ${message}`);
      company.universe_reason = company.universe_reason || `enrich_error:${message.slice(0, 120)}`;
    }
    byId.set(company.company_id, company);
    const n = ++completed;
    console.error(`[enrich] ${n}/${work.length} done`);
    if (n % 25 === 0 || n === work.length) writeJsonl(outPath, [...byId.values()]);
  });

  writeJsonl(outPath, [...byId.values()]);
  writeJson(join(ctx.runDir, 'enrichment', 'summary.json'), {
    enriched: companies.length,
    admitted: companies.length,
    classified_this_run: work.length,
    skipped,
    county: ctx.county || null,
  });
  return companies.map((c) => byId.get(c.company_id) ?? c);
}

export function runDoors(ctx: PipelineContext, companies?: CompanyRecord[], review?: ReviewRow[]): void {
  let rows = companies ?? readJsonl<CompanyRecord>(join(ctx.runDir, 'enrichment', 'companies.jsonl'));
  const county = parseCounty(ctx.county);
  if (county) rows = rows.filter((c) => matchesCounty(c, county));
  if (ctx.cities.length) rows = rows.filter((c) => matchesCities(c, ctx.cities));
  const reviewRows = review ?? readJsonl<ReviewRow>(join(ctx.runDir, 'universe', 'review.jsonl'));
  const { coverage } = scoreAndExport({ runDir: ctx.runDir, companies: rows, review: reviewRows });
  writeJson(join(ctx.runDir, 'output', 'summary.json'), {
    companies: rows.length,
    coverage,
  });
  console.error(`Wrote ${join(ctx.runDir, 'output', 'prospects.csv')} (recall ${(coverage.recall * 100).toFixed(1)}%)`);
}
