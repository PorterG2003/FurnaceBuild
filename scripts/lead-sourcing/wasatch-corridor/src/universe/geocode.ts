import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CENSUS_GEOCODER_URL, CENSUS_REVERSE_URL } from '../../config/sources.js';
import { readCached, requestHash, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import { RequestGate } from '../lib/retry.js';
import type { PipelineContext } from '../types.js';

export type GeocodeResult = {
  lat: number | null;
  lng: number | null;
  fips: string | null;
  placeName: string | null;
  county: string | null;
  matched: boolean;
};

type CensusResponse = {
  result?: {
    addressMatches?: Array<{
      coordinates?: { x?: number; y?: number };
      geographies?: {
        Counties?: Array<{ GEOID?: string; NAME?: string }>;
        'Incorporated Places'?: Array<{ NAME?: string }>;
        'Census Designated Places'?: Array<{ NAME?: string }>;
      };
    }>;
    geographies?: {
      Counties?: Array<{ GEOID?: string; NAME?: string }>;
      'Incorporated Places'?: Array<{ NAME?: string }>;
    };
  };
};

function fromMatch(json: CensusResponse): GeocodeResult {
  const match = json.result?.addressMatches?.[0];
  const geo = match?.geographies ?? json.result?.geographies;
  const county = geo?.Counties?.[0];
  const place = geo?.['Incorporated Places']?.[0] ?? geo?.['Census Designated Places']?.[0];
  const lat = match?.coordinates?.y ?? null;
  const lng = match?.coordinates?.x ?? null;
  return {
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
    fips: county?.GEOID ?? null,
    placeName: place?.NAME ?? null,
    county: county?.NAME ?? null,
    matched: Boolean(county?.GEOID),
  };
}

function fixtureLookup(address: string, lat?: number | null, lng?: number | null): GeocodeResult | null {
  const path = join(fixturesDir, 'geocode-map.json');
  if (!existsSync(path)) return null;
  const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, GeocodeResult>;
  if (address && map[address]) return map[address];
  const key = `${lat},${lng}`;
  if (map[key]) return map[key];
  const lower = address.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

export async function geocodeAddress(
  ctx: PipelineContext,
  gate: RequestGate,
  address: string,
): Promise<GeocodeResult> {
  const request = { address };
  if (ctx.fixtures) {
    const hit = fixtureLookup(address);
    const result = hit ?? { lat: null, lng: null, fips: null, placeName: null, county: null, matched: false };
    writeCached(ctx.cacheRoot, 'census', request, result);
    return result;
  }
  const cached = readCached<GeocodeResult>(ctx.cacheRoot, 'census', request);
  if (cached) return cached.body;

  const url = `${CENSUS_GEOCODER_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const json = await gate.schedule(async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Census geocode ${response.status}`);
    return (await response.json()) as CensusResponse;
  });
  const result = fromMatch(json);
  writeCached(ctx.cacheRoot, 'census', request, result);
  return result;
}

export async function reverseGeocode(
  ctx: PipelineContext,
  gate: RequestGate,
  lat: number,
  lng: number,
): Promise<GeocodeResult> {
  const request = { lat, lng };
  if (ctx.fixtures) {
    const hit = fixtureLookup('', lat, lng);
    const result = hit ?? { lat, lng, fips: null, placeName: null, county: null, matched: false };
    writeCached(ctx.cacheRoot, 'census-reverse', request, result);
    return result;
  }
  const cached = readCached<GeocodeResult>(ctx.cacheRoot, 'census-reverse', request);
  if (cached) return cached.body;

  const url = `${CENSUS_REVERSE_URL}?x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const json = await gate.schedule(async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Census reverse ${response.status}`);
    return (await response.json()) as CensusResponse;
  });
  const result = fromMatch(json);
  if (result.lat == null) result.lat = lat;
  if (result.lng == null) result.lng = lng;
  writeCached(ctx.cacheRoot, 'census-reverse', request, result);
  void requestHash;
  return result;
}
