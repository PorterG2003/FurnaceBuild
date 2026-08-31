import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configDir } from './lib/env.js';
import type { CcdDistrict, FeatureBins, FeaturesConfig, NumericBand, WonDistrict } from './types.js';

let cachedConfig: FeaturesConfig | null = null;

export function loadFeaturesConfig(path?: string): FeaturesConfig {
  if (!path && cachedConfig) return cachedConfig;
  const file = path ?? join(configDir, 'features.yaml');
  const config = parseYaml(readFileSync(file, 'utf8')) as FeaturesConfig;
  if (!path) cachedConfig = config;
  return config;
}

export function resetFeaturesConfigCache(): void {
  cachedConfig = null;
}

export function isCcdSentinel(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value) || value === -1 || value === -2 || value === -3;
}

export function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === -1 || n === -2 || n === -3) return null;
  return n;
}

export function asGrade(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n === -2 || n === -3) return null;
  return n;
}

export function bandId(value: number | null, bands: NumericBand[], missingId = 'unknown'): string {
  if (value == null || !Number.isFinite(value)) return missingId;
  for (const band of bands) {
    const minOk = band.min == null || value >= band.min;
    const maxOk = band.max == null || value <= band.max;
    if (minOk && maxOk) return band.id;
  }
  return missingId;
}

export function bandLabel(id: string, bands: NumericBand[], fallback?: string): string {
  return bands.find((b) => b.id === id)?.label ?? fallback ?? id;
}

export function gradeSpanClass(lowest: number | null, highest: number | null): string {
  if (lowest == null || highest == null || lowest === -2 || lowest === -3 || highest === -2 || highest === -3) {
    return 'unknown';
  }
  const lo = lowest;
  const hi = highest;
  if (lo <= 1 && hi <= 8) return 'elementary';
  if (lo >= 6 && hi >= 9) return 'secondary';
  if (lo <= 1 && hi >= 12) return 'unified';
  return 'other';
}

export function localeClass(code: number | null): string {
  if (isCcdSentinel(code)) return 'unknown';
  const n = code as number;
  if (n === 1 || n === 11 || n === 12 || n === 13) return 'city';
  if (n === 2 || n === 3 || n === 4 || n === 21 || n === 22 || n === 23) return 'suburb';
  if (n === 5 || n === 6 || n === 31 || n === 32 || n === 33) return 'town';
  if (n === 7 || n === 8 || n === 41 || n === 42 || n === 43) return 'rural';
  return 'unknown';
}

export function agencyClass(type: number | null, charter: number | null): string {
  if (type === 7 || charter === 1) return 'charter';
  if (type === 1) return 'regular';
  if (type === 9) return 'specialized';
  if (type === 5 || type === 6) return 'state_federal';
  if (isCcdSentinel(type)) return 'unknown';
  return 'other';
}

export function share(part: number | null, whole: number | null): number | null {
  if (isCcdSentinel(part) || isCcdSentinel(whole) || !whole) return null;
  return (part as number) / (whole as number);
}

export function studentTeacherRatio(enrollment: number | null, teachers: number | null): number | null {
  if (isCcdSentinel(enrollment) || isCcdSentinel(teachers) || !teachers) return null;
  return (enrollment as number) / (teachers as number);
}

export function milesBetween(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
): number | null {
  if (isCcdSentinel(a.latitude) || isCcdSentinel(a.longitude) || isCcdSentinel(b.latitude) || isCcdSentinel(b.longitude)) {
    return null;
  }
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 3958.8;
  const dLat = toRad((b.latitude as number) - (a.latitude as number));
  const dLon = toRad((b.longitude as number) - (a.longitude as number));
  const lat1 = toRad(a.latitude as number);
  const lat2 = toRad(b.latitude as number);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function districtWeight(district: WonDistrict, config: FeaturesConfig, totalRevenue: number, wonCount: number): number {
  const logo = config.logo_weight;
  const rev =
    totalRevenue > 0 ? config.revenue_weight * wonCount * (district.revenue / totalRevenue) : 0;
  return logo + rev;
}

export function geoCounts(
  district: CcdDistrict,
  wonCcd: CcdDistrict[],
  nearbyMiles: number,
): { sameCounty: number; nearby: number } {
  let sameCounty = 0;
  let nearby = 0;
  for (const won of wonCcd) {
    if (won.leaid === district.leaid) continue;
    if (district.county_code && won.county_code && district.county_code === won.county_code) {
      sameCounty += 1;
      continue;
    }
    const miles = milesBetween(district, won);
    if (miles != null && miles <= nearbyMiles) nearby += 1;
  }
  return { sameCounty, nearby };
}

export function assignBins(
  district: CcdDistrict,
  config: FeaturesConfig,
  geo: { sameCounty: number; nearby: number },
): FeatureBins {
  const enrollment = isCcdSentinel(district.enrollment) ? null : district.enrollment;
  const ell = share(district.english_language_learners, enrollment);
  const spec = share(district.spec_ed_students, enrollment);
  const str = studentTeacherRatio(enrollment, district.teachers_total_fte);
  return {
    enrollment: bandId(enrollment, config.enrollment_bands),
    grade_span: gradeSpanClass(district.lowest_grade_offered, district.highest_grade_offered),
    ell_share: bandId(ell, config.ell_share_bands),
    spec_ed_share: bandId(spec, config.spec_ed_share_bands),
    locale: localeClass(district.urban_centric_locale),
    agency: agencyClass(district.agency_type, district.agency_charter_indicator),
    str: bandId(str, config.str_bands),
    poverty_share: bandId(district.poverty_share, config.poverty_share_bands),
    geo_same_county: bandId(geo.sameCounty, config.geo_same_county_bands),
    geo_nearby: bandId(geo.nearby, config.geo_nearby_bands),
  };
}

const GRADE_SPAN_LABELS: Record<string, string> = {
  elementary: 'elementary-only',
  secondary: 'secondary-only',
  unified: 'unified/K-12',
  other: 'other grade span',
  unknown: 'unknown grade span',
};

const LOCALE_LABELS: Record<string, string> = {
  city: 'city locale',
  suburb: 'suburb locale',
  town: 'town locale',
  rural: 'rural locale',
  unknown: 'unknown locale',
};

const AGENCY_LABELS: Record<string, string> = {
  regular: 'regular district',
  charter: 'charter agency',
  specialized: 'specialized district',
  state_federal: 'state/federal agency',
  other: 'other agency',
  unknown: 'unknown agency',
};

export function featureLabel(feature: string, bin: string, config: FeaturesConfig): string {
  switch (feature) {
    case 'enrollment':
      return bandLabel(bin, config.enrollment_bands);
    case 'ell_share':
      return bandLabel(bin, config.ell_share_bands);
    case 'spec_ed_share':
      return bandLabel(bin, config.spec_ed_share_bands);
    case 'poverty_share':
      return bandLabel(bin, config.poverty_share_bands);
    case 'str':
      return bandLabel(bin, config.str_bands);
    case 'geo_same_county':
      return bandLabel(bin, config.geo_same_county_bands);
    case 'geo_nearby':
      return bandLabel(bin, config.geo_nearby_bands);
    case 'grade_span':
      return GRADE_SPAN_LABELS[bin] ?? bin;
    case 'locale':
      return LOCALE_LABELS[bin] ?? bin;
    case 'agency':
      return AGENCY_LABELS[bin] ?? bin;
    default:
      return `${feature}:${bin}`;
  }
}
