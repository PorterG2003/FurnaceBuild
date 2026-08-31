import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EPA_COUNTY_QUERIES, EPA_DROP_NAME_RE, FRS_GET_FACILITIES_URL, UNIVERSE_NAICS_EXCLUDE_PREFIXES } from '../../config/sources.js';
import { passesCorridorInclusion } from '../../config/geography.js';
import { readCached, requestHash, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import { writeJson } from '../lib/io.js';
import { RequestGate } from '../lib/retry.js';
import type { PipelineContext, RawHit } from '../types.js';

type FrsFacility = {
  registry_id?: string;
  RegistryId?: string;
  facility_name?: string;
  FacilityName?: string;
  location_address?: string;
  LocationAddress?: string;
  city_name?: string;
  CityName?: string;
  county_name?: string;
  CountyName?: string;
  state_abbr?: string;
  StateAbbr?: string;
  zip_code?: string;
  PostalCode?: string;
  latitude83?: number | string;
  Latitude83?: number | string;
  longitude83?: number | string;
  Longitude83?: number | string;
  naics_code?: string;
  NAICSCode?: string;
};

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  const n = Number(pick(row, keys));
  return Number.isFinite(n) ? n : null;
}

export function naicsExcluded(naics: string): boolean {
  const code = naics.replace(/\D/g, '');
  return UNIVERSE_NAICS_EXCLUDE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export function keepEpaFacility(row: FrsFacility): boolean {
  const name = pick(row as Record<string, unknown>, ['facility_name', 'FacilityName']);
  if (!name || EPA_DROP_NAME_RE.test(name)) return false;
  const naics = pick(row as Record<string, unknown>, ['naics_code', 'NAICSCode']);
  if (naicsExcluded(naics)) return false;
  const lat = pickNum(row as Record<string, unknown>, ['latitude83', 'Latitude83']);
  const lng = pickNum(row as Record<string, unknown>, ['longitude83', 'Longitude83']);
  const county = pick(row as Record<string, unknown>, ['county_name', 'CountyName']);
  const fips =
    county.toLowerCase().includes('salt lake') ? '49035'
    : county.toLowerCase() === 'utah' || county.toLowerCase().includes('utah county') ? '49049'
    : county.toLowerCase().includes('davis') ? '49011'
    : null;
  const place = pick(row as Record<string, unknown>, ['city_name', 'CityName']);
  return passesCorridorInclusion({ lat, fips, placeName: place });
}

export function epaToHit(row: FrsFacility, hash: string): RawHit {
  const rec = row as Record<string, unknown>;
  return {
    source: 'epa',
    name: pick(rec, ['facility_name', 'FacilityName']),
    domain: null,
    apollo_org_id: null,
    street: pick(rec, ['location_address', 'LocationAddress']),
    city: pick(rec, ['city_name', 'CityName']),
    state: pick(rec, ['state_abbr', 'StateAbbr']) || 'UT',
    postal: pick(rec, ['zip_code', 'PostalCode']),
    country: 'US',
    lat: pickNum(rec, ['latitude83', 'Latitude83']),
    lng: pickNum(rec, ['longitude83', 'Longitude83']),
    naics: pick(rec, ['naics_code', 'NAICSCode']),
    industry: '',
    employees: null,
    revenue_est: null,
    founded_year: null,
    headcount_growth_pct: null,
    last_funding_date: '',
    last_funding_amount: null,
    current_technologies: [],
    job_postings_json: '',
    raw_hash: hash,
    hq_city: pick(rec, ['city_name', 'CityName']),
    hq_state: pick(rec, ['state_abbr', 'StateAbbr']) || 'UT',
    hq_country: 'US',
    hq_street: pick(rec, ['location_address', 'LocationAddress']),
    query_city: pick(rec, ['city_name', 'CityName']),
    search_employee_band: '',
  };
}

function fixtureFacilities(): FrsFacility[] {
  const path = join(fixturesDir, 'epa-frs-utah.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as FrsFacility[];
}

async function fetchCounty(ctx: PipelineContext, county: string, gate: RequestGate): Promise<{ rows: FrsFacility[]; hash: string }> {
  const request = { state_abbr: 'UT', county_name: county, output: 'JSON' };
  if (ctx.fixtures) {
    const rows = fixtureFacilities().filter(
      (row) => pick(row as Record<string, unknown>, ['county_name', 'CountyName']).toLowerCase().includes(county.toLowerCase()),
    );
    const { hash } = writeCached(ctx.cacheRoot, 'epa-frs', request, rows);
    return { rows, hash };
  }
  const cached = readCached<FrsFacility[]>(ctx.cacheRoot, 'epa-frs', request);
  if (cached) return { rows: cached.body, hash: requestHash('epa-frs', request) };

  const url = `${FRS_GET_FACILITIES_URL}?state_abbr=UT&county_name=${encodeURIComponent(county)}&output=JSON`;
  const rows = await gate.schedule(async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`EPA FRS ${response.status} for ${county}`);
    const json = (await response.json()) as { Results?: { FRFacility?: FrsFacility[] | FrsFacility } } | FrsFacility[];
    if (Array.isArray(json)) return json;
    const inner = json.Results?.FRFacility;
    if (Array.isArray(inner)) return inner;
    if (inner) return [inner];
    return [];
  });
  const { hash } = writeCached(ctx.cacheRoot, 'epa-frs', request, rows);
  return { rows, hash };
}

export async function acquireEpa(ctx: PipelineContext): Promise<{ hits: RawHit[] }> {
  const gate = new RequestGate(400, 4);
  const hits: RawHit[] = [];
  for (const q of EPA_COUNTY_QUERIES) {
    const { rows, hash } = await fetchCounty(ctx, q.county_name, gate);
    for (const row of rows) {
      if (!keepEpaFacility(row)) continue;
      hits.push(epaToHit(row, hash));
    }
  }
  writeJson(join(ctx.runDir, 'universe', 'epa_status.json'), { kept: hits.length });
  return { hits };
}
