/** Query cities are API input only. Inclusion is geocoded FIPS + lat + place name. */

export const SALT_LAKE_FIPS = '49035';
export const UTAH_COUNTY_FIPS = '49049';
export const DAVIS_FIPS = '49011';

export const UTAH_COUNTY_MIN_LAT = 39.99;
export const DAVIS_PLACE_NAME = 'North Salt Lake';

/** Corridor bbox for FSQ OS Places extract (Payson north to North Salt Lake). */
export const CORRIDOR_BBOX = {
  minLat: 39.99,
  maxLat: 40.9,
  minLng: -112.15,
  maxLng: -111.55,
} as const;

export const DAVIS_CITIES = ['North Salt Lake'] as const;

export const SALT_LAKE_CITIES = [
  'Salt Lake City',
  'West Valley City',
  'West Jordan',
  'Sandy',
  'South Jordan',
  'Murray',
  'Taylorsville',
  'Herriman',
  'Riverton',
  'Draper',
  'Midvale',
  'Cottonwood Heights',
  'Holladay',
  'South Salt Lake',
  'Millcreek',
  'Bluffdale',
  'Magna',
  'Kearns',
  'Copperton',
  'Alta',
  'Brighton',
  'Emigration Canyon',
] as const;

export const UTAH_COUNTY_CITIES = [
  'Lehi',
  'Saratoga Springs',
  'Eagle Mountain',
  'American Fork',
  'Highland',
  'Alpine',
  'Cedar Hills',
  'Pleasant Grove',
  'Lindon',
  'Orem',
  'Vineyard',
  'Provo',
  'Springville',
  'Mapleton',
  'Spanish Fork',
  'Salem',
  'Payson',
  'Cedar Fort',
  'Fairfield',
  'Woodland Hills',
  'Elk Ridge',
  'Genola',
] as const;

export const QUERY_CITIES = [...DAVIS_CITIES, ...SALT_LAKE_CITIES, ...UTAH_COUNTY_CITIES] as const;

export const QUERY_COUNTIES = ['utah', 'salt_lake', 'davis'] as const;
export type QueryCounty = (typeof QUERY_COUNTIES)[number];

export const COUNTY_CITIES: Record<QueryCounty, readonly string[]> = {
  utah: UTAH_COUNTY_CITIES,
  salt_lake: SALT_LAKE_CITIES,
  davis: DAVIS_CITIES,
};

export function placeInCounty(place: string, county: QueryCounty): boolean {
  const n = normalizePlaceName(place);
  return COUNTY_CITIES[county].some((city) => normalizePlaceName(city) === n);
}

export const METRO_LOCATIONS = [
  'Salt Lake City, Utah, United States',
  'Provo, Utah, United States',
] as const;

export const EMPLOYEE_BANDS = ['1,10', '11,20', '21,50', '51,100', '101,200'] as const;

export function apolloLocation(city: string): string {
  return `${city}, Utah, United States`;
}

export function allApolloLocations(): string[] {
  return [...QUERY_CITIES.map(apolloLocation), ...METRO_LOCATIONS];
}

export type GeoInclusionInput = {
  lat: number | null;
  fips: string | null;
  placeName: string | null;
};

export function normalizePlaceName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/[.]/g, '');
}

export function passesCorridorInclusion(input: GeoInclusionInput): boolean {
  const fips = (input.fips ?? '').trim();
  if (fips === SALT_LAKE_FIPS) return true;
  if (fips === UTAH_COUNTY_FIPS) {
    return input.lat != null && Number.isFinite(input.lat) && input.lat >= UTAH_COUNTY_MIN_LAT;
  }
  if (fips === DAVIS_FIPS) {
    return normalizePlaceName(input.placeName) === normalizePlaceName(DAVIS_PLACE_NAME);
  }
  return false;
}

export function inCorridorBbox(lat: number, lng: number): boolean {
  return (
    lat >= CORRIDOR_BBOX.minLat &&
    lat <= CORRIDOR_BBOX.maxLat &&
    lng >= CORRIDOR_BBOX.minLng &&
    lng <= CORRIDOR_BBOX.maxLng
  );
}
