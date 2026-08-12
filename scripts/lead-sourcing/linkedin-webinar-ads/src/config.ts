export const DEFAULT_PHRASES = [
  'reserve your spot',
  'save your seat',
  'join us live',
  'limited seats',
  'spots remaining',
  'upcoming live session',
  'register for our live',
] as const;

export const DEFAULT_CONFIG = {
  country: 'US',
  dateWindowDays: 45,
  rateMs: 2_000,
  maxPagesPerPhrase: 10,
  maxAdsPerPhrase: 100,
  stalePageLimit: 3,
  phrases: [...DEFAULT_PHRASES],
  exclusionAdvertiserTerms: [
    'webinarjam',
    'demio',
    'livestorm',
    'goto webinar',
    'gotowebinar',
    'on24',
    'bigmarker',
  ],
} as const;

export type ScrapeConfig = {
  country: string;
  dateWindowDays: number;
  rateMs: number;
  maxPagesPerPhrase: number;
  maxAdsPerPhrase: number;
  stalePageLimit: number;
  phrases: readonly string[];
  exclusionAdvertiserTerms: readonly string[];
};
