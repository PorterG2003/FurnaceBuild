export const DEFAULT_PHRASES = [
  'free webinar',
  'upcoming webinar',
  'live webinar',
  'join our webinar',
  'join us for a webinar',
  'reserve your spot',
  'save your seat',
  'virtual event',
  'virtual summit',
] as const;

export const DEFAULT_CONFIG = {
  country: 'US',
  dateWindowDays: 45,
  rateMs: 2_000,
  maxScrollAttempts: 15,
  maxAdsPerPhrase: 100,
  staleScrollLimit: 4,
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
  maxScrollAttempts: number;
  maxAdsPerPhrase: number;
  staleScrollLimit: number;
  phrases: readonly string[];
  exclusionAdvertiserTerms: readonly string[];
};
