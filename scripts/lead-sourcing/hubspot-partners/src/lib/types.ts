export const DEFAULT_ACCREDITATION_ID = 43003;
export const DEFAULT_ACCREDITATION_NAME = 'CRM Implementation';
export const PROFILE_URL_BASE = 'https://ecosystem.hubspot.com/marketplace/solutions';

export type PartnerSearchRow = {
  listing_id: string;
  slug: string;
  listing_name: string;
  company_name: string;
  provider_name: string;
  description: string;
  logo_url: string;
  profile_url: string;
  partner_tier: string;
  partner_type: string;
  overall_rating: string;
  adjusted_rating: string;
  review_count: string;
  accreditation_id: string;
  accreditation_name: string;
  scraped_at: string;
};

export type PartnerEnrichedRow = PartnerSearchRow & {
  website: string;
  languages: string;
  services: string;
  service_names: string;
  industries: string;
  budget: string;
  regions: string;
  office_location: string;
  locations: string;
  company_size_specialty: string;
  source_id: string;
  listing_version_id: string;
  detail_status: string;
  detail_error: string;
};

export const PARTNER_SEARCH_COLUMNS: (keyof PartnerSearchRow)[] = [
  'listing_id',
  'slug',
  'listing_name',
  'company_name',
  'provider_name',
  'description',
  'logo_url',
  'profile_url',
  'partner_tier',
  'partner_type',
  'overall_rating',
  'adjusted_rating',
  'review_count',
  'accreditation_id',
  'accreditation_name',
  'scraped_at',
];

export const PARTNER_ENRICHED_COLUMNS: (keyof PartnerEnrichedRow)[] = [
  ...PARTNER_SEARCH_COLUMNS,
  'website',
  'languages',
  'services',
  'service_names',
  'industries',
  'budget',
  'regions',
  'office_location',
  'locations',
  'company_size_specialty',
  'source_id',
  'listing_version_id',
  'detail_status',
  'detail_error',
];

export type SearchCard = {
  listingId?: number;
  listingName?: string;
  providerName?: string;
  companyName?: string;
  description?: string;
  iconUrl?: string;
  slug?: string;
  products?: Array<{
    partnerTier?: string;
    partnerType?: string;
    productType?: string;
  }>;
  reviewSummary?: {
    overallRating?: number;
    overallAdjustedRating?: number;
    reviewCount?: number;
  };
};

export type SearchResponse = {
  total: number;
  cards: SearchCard[];
};

export type PartnerDetail = {
  urlSlug?: string;
  companyUrl?: string;
  companyName?: string;
  description?: string;
  languages?: string[];
  services?: Array<number | string>;
  industryChoice?: string[];
  budgetChoice?: string[];
  regionChoice?: string[];
  officeLocation?: string[];
  remoteLocations?: Array<{
    remoteLocation?: {
      full?: string;
      locality?: string;
      state?: string;
      country?: string;
    };
  }>;
  companySizeSpecialty?: string[];
  sourceId?: string;
  listingId?: number;
  listingVersionId?: number;
};

export type LabelMaps = {
  services: Record<string, string>;
  industries: Record<string, string>;
  budgets: Record<string, string>;
  certifications: Record<string, string>;
  accreditations: Record<string, string>;
  tiers: Record<string, string>;
};
