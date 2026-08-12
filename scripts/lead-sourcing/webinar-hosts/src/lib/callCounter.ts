export type ApiCallCounts = {
  serper_searches: number;
  apollo_org_calls: number;
  apollo_people_calls: number;
  openrouter_calls: number;
  linkedin_navigations: number;
};

export function emptyCallCounts(): ApiCallCounts {
  return {
    serper_searches: 0,
    apollo_org_calls: 0,
    apollo_people_calls: 0,
    openrouter_calls: 0,
    linkedin_navigations: 0,
  };
}

export class CallCounter {
  counts: ApiCallCounts = emptyCallCounts();

  increment(key: keyof ApiCallCounts, by = 1): void {
    this.counts[key] += by;
  }

  merge(other: ApiCallCounts): void {
    for (const key of Object.keys(this.counts) as (keyof ApiCallCounts)[]) {
      this.counts[key] += other[key];
    }
  }

  snapshot(): ApiCallCounts {
    return { ...this.counts };
  }
}

/** Conservative page estimate when pagination runs until SERP exhaustion. */
export const ESTIMATED_SERP_PAGES_PER_QUERY = 15;

export type CostEstimateInput = {
  queryCount: number;
  pagesPerQuery?: number | null;
  linkedinUrlCount: number;
  entityCount: number;
  openrouterEnabled: boolean;
};

export function estimateApiCalls(input: CostEstimateInput): ApiCallCounts {
  const pagesPerQuery = input.pagesPerQuery ?? ESTIMATED_SERP_PAGES_PER_QUERY;
  return {
    serper_searches: input.queryCount * pagesPerQuery,
    linkedin_navigations: input.linkedinUrlCount,
    apollo_org_calls: input.entityCount,
    apollo_people_calls: input.entityCount,
    openrouter_calls: input.openrouterEnabled ? input.entityCount : 0,
  };
}

export function exceedsSmokeLimits(
  estimated: ApiCallCounts,
  smoke: {
    max_queries: number;
    max_pages: number;
    max_linkedin_urls: number;
    max_apollo_org_lookups: number;
    max_apollo_people_searches: number;
    max_openrouter_calls: number;
  },
): boolean {
  return (
    estimated.serper_searches > smoke.max_queries * smoke.max_pages ||
    estimated.linkedin_navigations > smoke.max_linkedin_urls ||
    estimated.apollo_org_calls > smoke.max_apollo_org_lookups ||
    estimated.apollo_people_calls > smoke.max_apollo_people_searches ||
    estimated.openrouter_calls > smoke.max_openrouter_calls
  );
}
