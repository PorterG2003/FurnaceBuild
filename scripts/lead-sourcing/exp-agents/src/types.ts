export type CountryCode = 'US' | 'CA';

export type CliOptions = {
  country: 'us' | 'ca' | 'both';
  runDir?: string;
  resume: boolean;
  maxSuggestions: number | null;
  maxAgents: number | null;
  prefixes: string[] | null;
  rateMs: number;
  headed: boolean;
  suggestOnly: boolean;
  /** Use the old prefix-suggestions pipeline instead of state/province enumeration. */
  legacyPrefixes: boolean;
  /** Persistent Chrome profile path (default: output/.chrome-profile). */
  userDataDir?: string;
  /** Connect to existing Chrome, e.g. http://127.0.0.1:9222 */
  cdpUrl?: string;
  /** Pause for Enter when captcha/soft-ban is detected. */
  waitHuman: boolean;
};

export type AgentRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  photo_url: string;
  bio: string;
  source_name_query: string;
  scraped_at: string;
};

export type SearchAgent = {
  id: string;
  firstName: string;
  lastName: string;
  city: string;
  state: string;
  photo: string;
  email: string | null;
  phoneNumber: string | null;
  bio: string;
};

export type SuggestionsCheckpoint = {
  done: boolean;
  countries: Partial<
    Record<
      CountryCode,
      {
        done: boolean;
        queue: string[];
        completedPrefixes: string[];
        /** Prefixes that returned a non-empty suggestion list (even if all names were already known). */
        verifiedPrefixes?: string[];
        /** Prefixes confirmed empty while a known-good health probe passed. */
        verifiedEmptyPrefixes?: string[];
        suggestionCount: number;
      }
    >
  >;
};

export type AgentsCheckpoint = {
  done: boolean;
  countries: Partial<
    Record<
      CountryCode,
      {
        done: boolean;
        completedNames: string[];
        seenIds: string[];
        agentCount: number;
      }
    >
  >;
};

export type EnumerationSliceState = {
  done: boolean;
  nextFrom: number;
  reportedCount: number | null;
  rowsWritten: number;
  pagesCompleted: number;
  verifiedEmpty: boolean;
};

export type EnumerationCheckpoint = {
  done: boolean;
  countries: Partial<
    Record<
      CountryCode,
      {
        done: boolean;
        slices: Record<string, EnumerationSliceState>;
      }
    >
  >;
};

export const AGENT_CSV_COLUMNS: (keyof AgentRow)[] = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'city',
  'state',
  'country',
  'photo_url',
  'bio',
  'source_name_query',
  'scraped_at',
];

export const SUGGESTION_CAP = 65;
export const PAGE_SIZE = 12;
export const ENUMERATION_PAGE_SIZE = 100;
export const ELASTIC_RESULT_WINDOW = 10000;
export const GRAPHQL_URL = 'https://agentdir-api.expproptech.com/graphql';
export const RECAPTCHA_SITE_KEY = '6LccX5wpAAAAAHEw3YH2tWiHhZ2NFpV3Aq5lolo7';

export const COUNTRY_URLS: Record<CountryCode, string> = {
  US: 'https://www.exprealty.com/agents-search?country=US',
  CA: 'https://www.exprealty.ca/agents-search',
};

export const COUNTRY_LOCATIONS: Record<CountryCode, string[]> = {
  CA: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'],
  US: [
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC',
  ],
};
