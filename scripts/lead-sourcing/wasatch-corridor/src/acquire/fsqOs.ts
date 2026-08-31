import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CORRIDOR_BBOX, inCorridorBbox } from '../../config/geography.js';
import { FSQ_DROP_CATEGORY_RE, FSQ_KEEP_CATEGORY_RE } from '../../config/sources.js';
import { registrableDomain } from '../lib/domain.js';
import { fixturesDir } from '../lib/env.js';
import { writeJson } from '../lib/io.js';
import { readJsonl, writeJsonl } from '../lib/jsonl.js';
import type { PipelineContext, RawHit } from '../types.js';

export type FsqPlace = {
  name?: string;
  address?: string;
  locality?: string;
  region?: string;
  postcode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  website?: string | null;
  date_closed?: string | null;
  fsq_category_labels?: string[];
};

function categoryText(place: FsqPlace): string {
  return (place.fsq_category_labels ?? []).join(' ');
}

export function keepFsqPlace(place: FsqPlace): boolean {
  if (place.date_closed) return false;
  const lat = Number(place.latitude);
  const lng = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inCorridorBbox(lat, lng)) return false;
  const cats = categoryText(place);
  if (FSQ_DROP_CATEGORY_RE.test(cats)) return false;
  if (!cats) return true;
  return FSQ_KEEP_CATEGORY_RE.test(cats);
}

export function fsqPlaceToHit(place: FsqPlace): RawHit | null {
  const name = (place.name ?? '').trim();
  if (!name) return null;
  const domain = registrableDomain(place.website ?? '');
  return {
    source: 'fsq',
    name,
    domain,
    apollo_org_id: null,
    street: (place.address ?? '').trim(),
    city: (place.locality ?? '').trim(),
    state: (place.region ?? 'UT').trim(),
    postal: (place.postcode ?? '').trim(),
    country: (place.country ?? 'US').trim(),
    lat: Number(place.latitude),
    lng: Number(place.longitude),
    naics: '',
    industry: categoryText(place),
    employees: null,
    revenue_est: null,
    founded_year: null,
    headcount_growth_pct: null,
    last_funding_date: '',
    last_funding_amount: null,
    current_technologies: [],
    job_postings_json: '',
    raw_hash: 'fsq-os',
    hq_city: (place.locality ?? '').trim(),
    hq_state: (place.region ?? 'UT').trim(),
    hq_country: (place.country ?? 'US').trim(),
    hq_street: (place.address ?? '').trim(),
    query_city: (place.locality ?? '').trim(),
    search_employee_band: '',
  };
}

function loadPlaces(path: string): FsqPlace[] {
  if (path.endsWith('.jsonl')) return readJsonl<FsqPlace>(path);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as FsqPlace[] | { places?: FsqPlace[] };
  return Array.isArray(parsed) ? parsed : (parsed.places ?? []);
}

export async function acquireFsq(ctx: PipelineContext): Promise<{ hits: RawHit[]; extractPath: string }> {
  const cachedExtract = join(ctx.cacheRoot, 'raw', 'fsq-os', 'corridor.jsonl');
  const fixturePath = join(fixturesDir, 'fsq-os-corridor.json');
  let sourcePath: string | null = null;

  if (ctx.fsqExtract) sourcePath = resolve(ctx.fsqExtract);
  else if (existsSync(cachedExtract)) sourcePath = cachedExtract;
  else if (ctx.fixtures && existsSync(fixturePath)) sourcePath = fixturePath;

  if (!sourcePath) {
    const note = {
      skipped: true,
      reason:
        'No FSQ OS Places extract. Pass --fsq-extract path.jsonl, place a file at cache/raw/fsq-os/corridor.jsonl, or run with --fixtures.',
      bbox: CORRIDOR_BBOX,
    };
    writeJson(join(ctx.runDir, 'universe', 'fsq_status.json'), note);
    return { hits: [], extractPath: '' };
  }

  const places = loadPlaces(sourcePath).filter(keepFsqPlace);
  const hits = places.map(fsqPlaceToHit).filter((h): h is RawHit => h != null);
  writeJsonl(cachedExtract, places);
  writeJson(join(ctx.runDir, 'universe', 'fsq_status.json'), {
    skipped: false,
    source: sourcePath,
    kept: hits.length,
    bbox: CORRIDOR_BBOX,
  });
  return { hits, extractPath: sourcePath };
}
