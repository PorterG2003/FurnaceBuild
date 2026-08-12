export const PLATFORM = 'meta' as const;

export type QueryStatus = 'completed' | 'blocked' | 'error';
export type AdDisposition = 'qualified' | 'excluded' | 'review';

export type AdQuery = {
  phrase: string;
  searchUrl: string;
  collectedAt: string;
};

export type RawAd = {
  platform: typeof PLATFORM;
  adId: string | null;
  advertiserName: string | null;
  advertiserUrl: string | null;
  payerName: string | null;
  primaryText: string | null;
  headline: string | null;
  landingUrl: string | null;
  detailUrl: string | null;
  creativeImageUrls: string[];
  activeFrom: string | null;
  activeTo: string | null;
  status: string | null;
  query: AdQuery;
  extraction: {
    source: 'fixture' | 'dom';
    confidence: 'high' | 'partial';
    rawText: string;
  };
};

export type PersonEvidence = {
  name: string;
  evidence: string;
} | null;

export type NormalizedAd = RawAd & {
  dedupeKey: string;
  advertiserKey: string;
  phrases: string[];
  person: PersonEvidence;
  liveSignals: string[];
  exclusionReasons: string[];
  disposition: AdDisposition;
};

export type ReviewDecision = {
  adId: string | null;
  dedupeKey: string;
  decision: 'keep' | 'exclude' | 'review';
  note?: string;
};

export type AdvertiserRow = {
  advertiser_key: string;
  advertiser_name: string;
  advertiser_url: string;
  landing_domain: string;
  person_name: string;
  person_evidence: string;
  representative_ad_id: string;
  representative_copy: string;
  representative_headline: string;
  representative_landing_url: string;
  active_from: string;
  phrases: string;
  qualifying_ad_count: string;
};

export type QueryCheckpoint = {
  phrase: string;
  status: QueryStatus;
  nextPage: number;
  seenAdIds: string[];
  error?: string;
};

export type RunCheckpoint = {
  kind: 'meta_webinar_ads';
  version: 1;
  argsFingerprint: string;
  createdAt: string;
  updatedAt: string;
  status: 'in_progress' | 'completed';
  queries: QueryCheckpoint[];
  rawAds: RawAd[];
};
