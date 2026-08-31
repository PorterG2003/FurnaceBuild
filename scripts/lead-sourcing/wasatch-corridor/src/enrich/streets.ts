import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePlaceName } from '../../config/geography.js';
import { PROSPECT_COLUMNS } from '../doors/columns.js';
import { scoreAllDoors, scoreColdEmail } from '../doors/score.js';
import { readCached, writeCached } from '../lib/cache.js';
import { cell, writeCsv } from '../lib/csv.js';
import { fixturesDir } from '../lib/env.js';
import { ensureEnv } from '../lib/env.js';
import { writeJson } from '../lib/io.js';
import { readJsonl, writeJsonl } from '../lib/jsonl.js';
import { requireLiveForPaid } from '../lib/cli.js';
import { RequestGate } from '../lib/retry.js';
import type { CompanyRecord, PipelineContext } from '../types.js';
import { geocodeAddress } from '../universe/geocode.js';
import { serperSearch } from '../../../webinar-outreach-enrich/src/serperClient.js';

export const STREETS_DEFAULT_CITIES = ['Orem', 'Provo'] as const;

export const STREET_PROSPECT_COLUMNS = [
  ...PROSPECT_COLUMNS.slice(0, 10),
  'street',
  'census_place',
  'lat',
  'lng',
  ...PROSPECT_COLUMNS.slice(10),
] as const;

const STREET_SUFFIX =
  'st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|way|ct|court|pkwy|parkway|cir|circle|pl|place|ter|terrace|hwy|highway|trl|trail|loop';

const STREET_CORE = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,6}\s+(?:${STREET_SUFFIX})\b\.?`,
  'i',
);

const UTAH_GRID = /\b\d{1,6}\s+[NSEW]\.?\s+\d{1,5}(?:st|nd|rd|th)?\s+[NSEW]\.?\b/i;

export type HqSerperResponse = {
  knowledgeGraph?: {
    website?: string;
    title?: string;
    description?: string;
    address?: string;
    attributes?: Record<string, string>;
  };
  organic?: Array<{ title?: string; snippet?: string; link?: string }>;
};

export type ParsedHqAddress = {
  street: string;
  city: string;
  raw: string;
};

export type StreetReviewReason = '' | 'missing_street' | 'geocode_failure' | 'wrong_city';

export type StreetSidecarRow = {
  company_id: string;
  name: string;
  domain: string;
  street: string;
  city: string;
  census_place: string;
  lat: number | null;
  lng: number | null;
  fips: string;
  hq_address: string;
  status: 'keep' | 'review';
  reason: StreetReviewReason;
  serper_calls: number;
  skipped_serper: boolean;
  query_city: string;
};

export type SerperSearchFn = (query: string) => Promise<HqSerperResponse>;

export type StreetsResult = {
  qualified: number;
  already_have_street: number;
  serper_needed: number;
  serper_live_calls: number;
  serper_cache_hits: number;
  keep: number;
  review: number;
  sidecarPath: string;
  csvPath: string;
};

const SERPER_DOLLARS_PER_CALL = 0.001;

export function streetsCities(cities: string[]): string[] {
  return cities.length ? cities : [...STREETS_DEFAULT_CITIES];
}

export function hasStreetNumber(value: string | null | undefined): boolean {
  return /\b\d{1,6}\s+[A-Za-z0-9]/.test(value ?? '');
}

export function needsSerper(company: Pick<CompanyRecord, 'street' | 'hq_address'>): boolean {
  return !hasStreetNumber(company.street) && !hasStreetNumber(company.hq_address);
}

export function censusPlaceAllowed(placeName: string | null | undefined, cities: string[]): boolean {
  const place = stripPlaceSuffix(normalizePlaceName(placeName));
  if (!place) return false;
  return cities.some((city) => stripPlaceSuffix(normalizePlaceName(city)) === place);
}

function stripPlaceSuffix(name: string): string {
  return name.replace(/\s+(city|cdp|town|village)$/i, '').trim();
}

export function hqQuery(company: Pick<CompanyRecord, 'name' | 'domain'>, withCities: boolean): string {
  const name = (company.name ?? '').replace(/"/g, '').trim();
  const domain = (company.domain ?? '').trim();
  const cityClause = withCities ? 'Orem OR Provo Utah' : 'Utah';
  return `"${name}" ${domain} headquarters address ${cityClause}`.replace(/\s+/g, ' ').trim();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cityFromText(text: string): string {
  const known = text.match(
    /\b(Orem|Provo|Lehi|Lindon|Pleasant Grove|American Fork|Springville|Spanish Fork|Payson|Draper|Midvale|Sandy|Salt Lake City)\b/i,
  );
  if (known?.[1]) {
    return known[1].replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  const generic = text.match(/,\s*([A-Za-z .']+?),\s*(?:UT|Utah)\b/i);
  return generic?.[1]?.trim() ?? '';
}

export function parseStreetFromText(text: string): { street: string; city: string } | null {
  const blob = collapse(text);
  if (!blob) return null;
  const match = blob.match(STREET_CORE) ?? blob.match(UTAH_GRID);
  if (!match?.[0]) return null;
  const street = collapse(match[0].replace(/\.$/, ''));
  if (!hasStreetNumber(street)) return null;
  return { street, city: cityFromText(blob) };
}

export function parseHqFromSerper(json: HqSerperResponse): ParsedHqAddress | null {
  const blobs: string[] = [];
  if (json.knowledgeGraph?.address) blobs.push(json.knowledgeGraph.address);
  for (const value of Object.values(json.knowledgeGraph?.attributes ?? {})) {
    if (value) blobs.push(value);
  }
  if (json.knowledgeGraph?.description) blobs.push(json.knowledgeGraph.description);
  for (const row of json.organic ?? []) {
    if (row.title) blobs.push(row.title);
    if (row.snippet) blobs.push(row.snippet);
  }
  for (const blob of blobs) {
    const parsed = parseStreetFromText(blob);
    if (parsed) return { ...parsed, raw: collapse(blob) };
  }
  return null;
}

export function formatCensusAddress(street: string, city: string): string {
  if (/,/.test(street) && /\b(UT|Utah)\b/i.test(street)) return street;
  const cityPart = city && !new RegExp(`\\b${city}\\b`, 'i').test(street) ? city : '';
  return [street, cityPart, 'UT'].filter(Boolean).join(', ');
}

export function existingStreet(company: Pick<CompanyRecord, 'street' | 'hq_address'>): string {
  if (hasStreetNumber(company.street)) return company.street.trim();
  if (hasStreetNumber(company.hq_address)) return company.hq_address.trim();
  return '';
}

function inCities(company: Pick<CompanyRecord, 'city' | 'query_city'>, cities: string[]): boolean {
  if (!cities.length) return true;
  const places = [company.city, company.query_city].map((place) => normalizePlaceName(place));
  return cities.some((city) => places.includes(normalizePlaceName(city)));
}

function displayPlace(place: string | null | undefined, fallback: string): string {
  const stripped = stripPlaceSuffix(normalizePlaceName(place));
  if (!stripped) return fallback;
  return stripped.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function selectQualifiedForStreets(
  companies: CompanyRecord[],
  cities: string[],
): CompanyRecord[] {
  return companies.filter((company) => inCities(company, cities) && scoreColdEmail(company).qualified);
}

export function printStreetsEstimate(options: {
  qualified: number;
  already_have_street: number;
  serper_needed: number;
  cities: string[];
}): void {
  const payload = {
    wave: 'streets',
    vendor: 'Serper search',
    cities: options.cities,
    qualified: options.qualified,
    already_have_street: options.already_have_street,
    serper_calls_default: options.serper_needed,
    serper_calls_worst: options.serper_needed * 2,
    dollars_est: Number((options.serper_needed * SERPER_DOLLARS_PER_CALL).toFixed(3)),
    dollars_worst: Number((options.serper_needed * 2 * SERPER_DOLLARS_PER_CALL).toFixed(3)),
    census: '$0',
    apollo: 0,
    note: 'One Serper query per missing street; second query only if parse fails. No live Serper until --live after explicit spend OK.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

function loadSerperFixture(query: string): HqSerperResponse {
  const mapPath = join(fixturesDir, 'serper', 'query-map.json');
  let relative = '';
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;
    relative =
      map[query] ??
      Object.entries(map).find(([key]) => query.includes(key) || key.includes(query))?.[1] ??
      '';
  }
  const path = relative
    ? join(fixturesDir, 'serper', relative)
    : join(fixturesDir, 'serper', 'empty.json');
  if (!existsSync(path)) return { organic: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as HqSerperResponse;
}

async function searchHq(
  ctx: PipelineContext,
  query: string,
  tally: { live: number; cache: number },
  gate: RequestGate,
): Promise<HqSerperResponse> {
  const request = { q: query, gl: 'us', hl: 'en', num: 5 };
  const cached = readCached<HqSerperResponse>(ctx.cacheRoot, 'serper', request);
  if (cached) {
    tally.cache += 1;
    return cached.body;
  }
  if (ctx.fixtures) {
    const body = loadSerperFixture(query);
    writeCached(ctx.cacheRoot, 'serper', request, body);
    tally.cache += 1;
    return body;
  }
  return gate.schedule(async () => {
    tally.live += 1;
    const body = (await serperSearch(query)) as HqSerperResponse;
    writeCached(ctx.cacheRoot, 'serper', request, body);
    return body;
  });
}

function cloneCompany(company: CompanyRecord): CompanyRecord {
  return {
    ...company,
    sources: [...company.sources],
    current_technologies: [...company.current_technologies],
    webinar_pages: [...company.webinar_pages],
    provenance: { ...company.provenance },
  };
}

function applyKeep(company: CompanyRecord, options: {
  street: string;
  city: string;
  lat: number | null;
  lng: number | null;
  fips: string | null;
  census_place: string | null;
  county: string | null;
  source: 'serper' | 'existing';
}): void {
  const now = new Date().toISOString();
  company.street = options.street;
  if (options.city) company.city = options.city;
  company.lat = options.lat;
  company.lng = options.lng;
  company.fips = options.fips;
  company.census_place = options.census_place;
  if (options.county) company.county = options.county;
  company.state = company.state || 'UT';
  company.hq_address = formatCensusAddress(options.street, options.city || company.city);
  company.provenance.street = { source: options.source, cached_at: now };
  company.provenance.census_place = { source: 'census', cached_at: now };
}

function sidecarRow(
  company: CompanyRecord,
  status: 'keep' | 'review',
  reason: StreetReviewReason,
  serperCalls: number,
  skippedSerper: boolean,
): StreetSidecarRow {
  return {
    company_id: company.company_id,
    name: company.name,
    domain: company.domain ?? '',
    street: company.street,
    city: company.city,
    census_place: company.census_place ?? '',
    lat: company.lat,
    lng: company.lng,
    fips: company.fips ?? '',
    hq_address: company.hq_address,
    status,
    reason,
    serper_calls: serperCalls,
    skipped_serper: skippedSerper,
    query_city: company.query_city,
  };
}

function walkableRow(rank: number, company: CompanyRecord): Record<string, string> {
  const routed = scoreAllDoors(company);
  const cold = routed.doors.find((d) => d.door === 'cold_email');
  const web = routed.doors.find((d) => d.door === 'webinar');
  const recentFunding =
    Boolean(company.last_funding_date) &&
    Date.now() - Date.parse(company.last_funding_date) < 18 * 30.44 * 24 * 3600 * 1000;
  return {
    rank: String(rank),
    company: cell(company.name),
    primary_door: cell(routed.primary_door),
    routing_score: cell(routed.routing_score.toFixed(2)),
    secondary_door: cell(routed.secondary_door),
    cold_email_qualified: cell(Boolean(cold?.qualified)),
    cold_email_score: cell(cold?.score),
    webinar_qualified: cell(Boolean(web?.qualified)),
    webinar_score: cell(web?.score),
    city: cell(company.city),
    street: cell(company.street),
    census_place: cell(company.census_place),
    lat: cell(company.lat),
    lng: cell(company.lng),
    query_city: cell(company.query_city),
    county: cell(company.county),
    state: cell(company.state || 'UT'),
    domain: cell(company.domain),
    what_they_sell: cell(company.what_they_sell),
    category: cell(company.category),
    b2b_type: cell(company.b2b_type),
    primary_buyer: cell(company.primary_buyer),
    customer_geo: cell(company.customer_geo),
    target_audience: cell(company.target_audience),
    employees: cell(company.employees),
    search_employee_band: cell(company.search_employee_band),
    revenue_est: cell(company.revenue_est),
    low_confidence_size: cell(company.low_confidence_size),
    sdr_headcount: cell(company.sdr_headcount),
    ae_headcount: cell(company.ae_headcount),
    outbound_marketer_detected: cell(company.outbound_marketer_detected),
    sequencer_detected: cell(company.sequencer_detected),
    sequencer_orphaned: cell(company.sequencer_orphaned),
    runs_webinars: cell(company.runs_webinars),
    webinar_platform: cell(company.webinar_platform),
    webinar_purpose: cell(company.webinar_purpose),
    webinar_cadence: cell(company.webinar_cadence),
    webinar_recency: cell(company.webinar_recency),
    webinar_audience: cell(company.webinar_audience),
    audience_is_ce_profession: cell(company.audience_is_ce_profession),
    webinar_role_detected: cell(company.webinar_role_detected),
    hiring_gtm: cell(company.hiring_gtm),
    headcount_growth_pct: cell(company.headcount_growth_pct),
    recent_funding: cell(recentFunding),
    hq_verification: cell(company.hq_verification),
    hq_address: cell(company.hq_address),
    sources: cell(company.sources.join('|')),
  };
}

export async function runStreets(
  ctx: PipelineContext,
  options: { search?: SerperSearchFn } = {},
): Promise<StreetsResult> {
  const cities = streetsCities(ctx.cities);
  const companies = readJsonl<CompanyRecord>(join(ctx.runDir, 'enrichment', 'companies.jsonl'));
  let qualified = selectQualifiedForStreets(companies, cities);
  if (ctx.maxRows != null) qualified = qualified.slice(0, ctx.maxRows);

  const alreadyHaveStreet = qualified.filter((c) => !needsSerper(c)).length;
  const serperNeeded = qualified.length - alreadyHaveStreet;

  if (ctx.dryRun && !ctx.fixtures) {
    printStreetsEstimate({
      qualified: qualified.length,
      already_have_street: alreadyHaveStreet,
      serper_needed: serperNeeded,
      cities,
    });
    writeJson(join(ctx.runDir, 'enrichment', 'streets_dry_run.json'), {
      qualified: qualified.length,
      already_have_street: alreadyHaveStreet,
      serper_needed: serperNeeded,
      cities,
    });
    return {
      qualified: qualified.length,
      already_have_street: alreadyHaveStreet,
      serper_needed: serperNeeded,
      serper_live_calls: 0,
      serper_cache_hits: 0,
      keep: 0,
      review: 0,
      sidecarPath: join(ctx.runDir, 'enrichment', 'orem_provo_streets.jsonl'),
      csvPath: join(ctx.runDir, 'output', 'orem-provo', 'prospects.csv'),
    };
  }

  if (!ctx.fixtures && !options.search) {
    requireLiveForPaid({
      live: ctx.live,
      dryRun: ctx.dryRun,
      fixtures: ctx.fixtures,
      vendor: 'Serper',
    });
    await ensureEnv({ serper: true });
    if (!process.env.SERPER_API_KEY?.trim()) {
      throw new Error('SERPER_API_KEY is required for live street search.');
    }
  }

  const sidecarPath = join(ctx.runDir, 'enrichment', 'orem_provo_streets.jsonl');
  const csvPath = join(ctx.runDir, 'output', 'orem-provo', 'prospects.csv');
  const existingSidecar = readJsonl<StreetSidecarRow>(sidecarPath);
  const done = new Map(existingSidecar.map((row) => [row.company_id, row]));
  const censusGate = new RequestGate(1100, 4);
  const serperGate = new RequestGate(250, 4);
  const tally = { live: 0, cache: 0 };
  const kept: CompanyRecord[] = [];

  let i = 0;
  for (const incoming of qualified) {
    i += 1;
    const prior = done.get(incoming.company_id);
    if (prior) {
      if (prior.status === 'keep') {
        const company = cloneCompany(incoming);
        company.street = prior.street;
        company.city = prior.city || company.city;
        company.census_place = prior.census_place || company.census_place;
        company.lat = prior.lat;
        company.lng = prior.lng;
        company.fips = prior.fips || company.fips;
        company.hq_address = prior.hq_address || company.hq_address;
        kept.push(company);
      }
      continue;
    }

    const company = cloneCompany(incoming);
    const skippedSerper = !needsSerper(company);
    let serperCalls = 0;
    let parsed: ParsedHqAddress | null = null;
    const knownStreet = existingStreet(company);

    if (skippedSerper) {
      parsed = parseStreetFromText(knownStreet) ?? {
        street: knownStreet,
        city: cityFromText(knownStreet) || company.city,
        raw: knownStreet,
      };
    } else {
      const queries = [hqQuery(company, true), hqQuery(company, false)];
      for (const query of queries) {
        const json = options.search
          ? await options.search(query)
          : await searchHq(ctx, query, tally, serperGate);
        serperCalls += 1;
        parsed = parseHqFromSerper(json);
        if (parsed) break;
      }
    }

    if (!parsed) {
      done.set(incoming.company_id, sidecarRow(company, 'review', 'missing_street', serperCalls, skippedSerper));
      writeJsonl(sidecarPath, [...done.values()]);
      console.error(`[streets] ${i}/${qualified.length} ${company.name} missing_street`);
      continue;
    }

    const cityHint = parsed.city || (censusPlaceAllowed(company.city, cities) ? company.city : '');
    const address = formatCensusAddress(parsed.street, cityHint);
    const geo = await geocodeAddress(ctx, censusGate, address);
    if (!geo.matched) {
      company.street = parsed.street;
      done.set(incoming.company_id, sidecarRow(company, 'review', 'geocode_failure', serperCalls, skippedSerper));
      writeJsonl(sidecarPath, [...done.values()]);
      console.error(`[streets] ${i}/${qualified.length} ${company.name} geocode_failure`);
      continue;
    }
    if (!censusPlaceAllowed(geo.placeName, cities)) {
      company.street = parsed.street;
      company.census_place = geo.placeName;
      company.lat = geo.lat;
      company.lng = geo.lng;
      company.fips = geo.fips;
      done.set(incoming.company_id, sidecarRow(company, 'review', 'wrong_city', serperCalls, skippedSerper));
      writeJsonl(sidecarPath, [...done.values()]);
      console.error(`[streets] ${i}/${qualified.length} ${company.name} wrong_city:${geo.placeName}`);
      continue;
    }

    applyKeep(company, {
      street: parsed.street,
      city: displayPlace(geo.placeName, parsed.city),
      lat: geo.lat,
      lng: geo.lng,
      fips: geo.fips,
      census_place: geo.placeName,
      county: geo.county,
      source: skippedSerper ? 'existing' : 'serper',
    });
    kept.push(company);
    done.set(incoming.company_id, sidecarRow(company, 'keep', '', serperCalls, skippedSerper));
    writeJsonl(sidecarPath, [...done.values()]);
    console.error(`[streets] ${i}/${qualified.length} ${company.name} keep ${company.street}`);
  }

  kept.sort((a, b) => scoreAllDoors(b).routing_score - scoreAllDoors(a).routing_score);
  writeCsv(
    csvPath,
    kept.map((company, index) => walkableRow(index + 1, company)),
    STREET_PROSPECT_COLUMNS,
  );

  const rows = [...done.values()];
  const keep = rows.filter((r) => r.status === 'keep').length;
  const review = rows.filter((r) => r.status === 'review').length;
  const liveCalls = tally.live;
  writeJson(join(ctx.runDir, 'enrichment', 'streets_summary.json'), {
    cities,
    qualified: qualified.length,
    already_have_street: alreadyHaveStreet,
    serper_needed: serperNeeded,
    serper_live_calls: liveCalls,
    serper_cache_hits: tally.cache,
    keep,
    review,
  });
  console.error(
    `[streets] keep=${keep} review=${review} serper_live=${liveCalls} cache=${tally.cache} -> ${csvPath}`,
  );

  return {
    qualified: qualified.length,
    already_have_street: alreadyHaveStreet,
    serper_needed: serperNeeded,
    serper_live_calls: liveCalls,
    serper_cache_hits: tally.cache,
    keep,
    review,
    sidecarPath,
    csvPath,
  };
}
