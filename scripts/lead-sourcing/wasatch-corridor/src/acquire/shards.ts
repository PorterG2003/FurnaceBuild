import { EMPLOYEE_BANDS, allApolloLocations, apolloLocation } from '../../config/geography.js';

export type ApolloShard = {
  location: string;
  employee_band: string;
  key: string;
};

export type ShardFilter = {
  cities?: string[];
  bands?: string[];
};

export function listApolloShards(filter: ShardFilter = {}): ApolloShard[] {
  const bands = filter.bands?.length ? filter.bands : [...EMPLOYEE_BANDS];
  const locations = filter.cities?.length ? filter.cities.map(apolloLocation) : allApolloLocations();
  const shards: ApolloShard[] = [];
  for (const location of locations) {
    for (const employee_band of bands) {
      shards.push({
        location,
        employee_band,
        key: `${location}::${employee_band}`,
      });
    }
  }
  return shards;
}

export function estimateApolloSearchPages(shardCount: number): {
  shards: number;
  estimated_pages: number;
  estimated_credits_low: number;
  estimated_credits_high: number;
} {
  return {
    shards: shardCount,
    estimated_pages: shardCount,
    estimated_credits_low: Math.round(shardCount * 1.1),
    estimated_credits_high: Math.round(shardCount * 1.8),
  };
}
