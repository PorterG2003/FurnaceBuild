import competitorAuditAdvertiser from '../../../../lib/flux/fluxCompetitorAuditAdvertiser.js';
import type { TransparencyCreativeSampleRow } from './transparencyCreativeDisplay.js';

export interface PreparedPublishedCompetitorExample {
  headline: string;
  body: string;
  sourceUrl: string;
  previewPng?: Buffer;
}

export function buildPublishedCompetitorExamples(params: {
  domain: string;
  samples: TransparencyCreativeSampleRow[];
  maxExamples: number;
  selectedAdvertiserId?: string | null;
}): {
  selectedAdvertiserId: string | null;
  examples: PreparedPublishedCompetitorExample[];
} {
  const sliced = params.samples.slice(0, Math.max(1, params.maxExamples));
  if (sliced.length < 1) {
    throw new Error(`No publishable samples for ${params.domain}`);
  }

  const fallbackAdvertiserId = competitorAuditAdvertiser.extractGoogleAdsAdvertiserId(sliced[0]?.sourceUrl);
  const selectedAdvertiserId = params.selectedAdvertiserId?.trim() || fallbackAdvertiserId || null;
  const filtered = competitorAuditAdvertiser.filterExamplesToAdvertiser(sliced, selectedAdvertiserId);
  if (selectedAdvertiserId && filtered.length !== sliced.length) {
    const advertiserIds = competitorAuditAdvertiser.getCompetitorRowAdvertiserIds(sliced);
    throw new Error(
      `Mixed advertiser samples for ${params.domain}: expected ${selectedAdvertiserId}, got ${advertiserIds.join(', ')}`,
    );
  }
  if (!competitorAuditAdvertiser.competitorExamplesAreSingleAdvertiser(filtered)) {
    const advertiserIds = competitorAuditAdvertiser.getCompetitorRowAdvertiserIds(filtered);
    throw new Error(`Publish examples for ${params.domain} mix advertiser IDs (${advertiserIds.join(', ')})`);
  }
  if (filtered.length < 1) {
    throw new Error(`No publishable samples remain for ${params.domain}`);
  }

  return {
    selectedAdvertiserId,
    examples: filtered.map((sample) => ({
      headline: (sample.headline || sample.body.slice(0, 80) || 'Ad creative').slice(0, 200),
      body: sample.body.slice(0, 400),
      sourceUrl: sample.sourceUrl,
      ...(sample.previewPng && sample.previewPng.length > 0 ? { previewPng: sample.previewPng } : {}),
    })),
  };
}
