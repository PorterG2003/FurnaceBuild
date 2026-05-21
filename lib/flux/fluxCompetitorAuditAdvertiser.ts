const GOOGLE_ADS_ADVERTISER_ID_RE = /\bAR[A-Z0-9]{8,}\b/i;

type ExampleLike = {
  sourceUrl?: string | null;
};

type CompetitorLike = {
  name?: string | null;
  examples?: ExampleLike[] | null;
};

export function extractGoogleAdsAdvertiserId(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.trim()) return null;
  const match = sourceUrl.match(GOOGLE_ADS_ADVERTISER_ID_RE);
  return match?.[0] ?? null;
}

export function getCompetitorRowAdvertiserIds(examples: ExampleLike[] | null | undefined): string[] {
  if (!Array.isArray(examples) || examples.length < 1) return [];
  const ids = new Set<string>();
  for (const example of examples) {
    const advertiserId = extractGoogleAdsAdvertiserId(example?.sourceUrl);
    if (advertiserId) ids.add(advertiserId);
  }
  return [...ids];
}

export function competitorExamplesAreSingleAdvertiser(examples: ExampleLike[] | null | undefined): boolean {
  return getCompetitorRowAdvertiserIds(examples).length <= 1;
}

export function filterExamplesToAdvertiser<T extends ExampleLike>(
  examples: T[] | null | undefined,
  advertiserId: string | null | undefined,
): T[] {
  if (!Array.isArray(examples) || examples.length < 1) return [];
  if (!advertiserId?.trim()) return [...examples];
  return examples.filter((example) => extractGoogleAdsAdvertiserId(example?.sourceUrl) === advertiserId);
}

export function getCompetitorAdAuditConsistencyIssues(competitors: CompetitorLike[] | null | undefined): string[] {
  if (!Array.isArray(competitors) || competitors.length < 1) return [];
  const issues: string[] = [];
  const seenAdvertiserIds = new Map<string, number>();
  for (let index = 0; index < competitors.length; index += 1) {
    const competitor = competitors[index];
    const advertiserIds = getCompetitorRowAdvertiserIds(competitor?.examples);
    if (advertiserIds.length > 1) {
      issues.push(
        `competitors[${index}] examples mix advertiser IDs (${advertiserIds.join(', ')})`,
      );
      continue;
    }
    const advertiserId = advertiserIds[0];
    if (!advertiserId) continue;
    const firstSeenIndex = seenAdvertiserIds.get(advertiserId);
    if (typeof firstSeenIndex === 'number') {
      issues.push(
        `competitors[${index}] shares advertiser ID ${advertiserId} with competitors[${firstSeenIndex}]`,
      );
      continue;
    }
    seenAdvertiserIds.set(advertiserId, index);
  }
  return issues;
}

const fluxCompetitorAuditAdvertiser = {
  extractGoogleAdsAdvertiserId,
  getCompetitorRowAdvertiserIds,
  competitorExamplesAreSingleAdvertiser,
  filterExamplesToAdvertiser,
  getCompetitorAdAuditConsistencyIssues,
};

export default fluxCompetitorAuditAdvertiser;
