export const SEQUENCER_TECH_UIDS = [
  'outreach',
  'salesloft',
  'apollo',
  'apollo_io',
  'instantly',
  'smartlead',
  'lemlist',
  'reply',
  'reply_io',
  'woodpecker',
  'mailshake',
  'klenty',
  'amplemarket',
] as const;

export const SEQUENCER_NAME_RE =
  /\b(outreach\.io|salesloft|instantly|smartlead|lemlist|reply\.io|woodpecker|mailshake|klenty|amplemarket)\b/i;

export const OUTBOUND_MARKETER_TITLE_RE =
  /\b(demand\s*gen(?:eration)?|marketing\s*automation|outbound\s*marketing|email\s*marketing|growth\s*marketing)\b/i;

export const SDR_TITLE_RE = /\b(sdr|bdr|sales\s*development|business\s*development\s*rep)/i;
export const AE_TITLE_RE =
  /\b(account\s*executive|ae\b|enterprise\s*account|closing\s*rep)\b/i;
export const SALES_TITLE_RE = /\b(sales|sdr|bdr|account\s*executive|account\s*manager|ae\b)/i;

export const GTM_HIRING_RE =
  /\b(sdr|bdr|account\s*executive|sales\s*development|demand\s*gen|growth\s*marketing|revenue\s*operations|revops|gtm)\b/i;

export const OUTBOUND_SHOP_RE =
  /\b(lead\s*gen(?:eration)?|cold\s*email\s*agency|sdr[- ]as[- ]a[- ]service|appointment\s*setting|b2b\s*appointment|outbound\s*agency|sales\s*engagement\s*agency)\b/i;

export const OUTBOUND_CONFIRM_RE =
  /\b(cold\s*email|outbound\s*sequence|linkedin\s*automation|salesloft|instantly|smartlead|lemlist|outreach\.io|woodpecker|mailshake|klenty|amplemarket)\b/i;

export const WEBINAR_PLATFORMS = [
  'ON24',
  'GoToWebinar',
  'Demio',
  'Livestorm',
  'BigMarker',
  'WebinarJam',
  'EverWebinar',
  'Zoom Webinars',
  'Zoom Events',
  'Goldcast',
  'Contrast',
  'Welcome',
  'Hopin',
] as const;

export const WEBINAR_PLATFORM_RE =
  /\b(on24|gotowebinar|go\s*to\s*webinar|demio|livestorm|bigmarker|webinarjam|everwebinar|zoom\s*webinars?|zoom\s*events|goldcast|contrast\.co|welcomesoftware|hopin)\b/i;

export const WEBINAR_PAGE_PATHS = [
  '/webinar',
  '/webinars',
  '/events',
  '/resources',
  '/training',
  '/live',
] as const;

export const REGISTRATION_RE = /\b(register|save your seat|save my seat|join us live|reserve your spot)\b/i;

export const CE_PROFESSIONS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(therapists?|counselors?|mental\s*health|lmft|lcsw|lpc)\b/i, label: 'licensed mental health therapists' },
  { re: /\b(physicians?|doctors?|md\b|clinicians?)\b/i, label: 'physicians' },
  { re: /\b(nurses?|rn\b|np\b|aprn)\b/i, label: 'nurses' },
  { re: /\b(dentists?|dental\s*hygien)/i, label: 'dentists' },
  { re: /\b(accountants?|cpa\b|cpas\b)\b/i, label: 'accountants' },
  { re: /\b(financial\s*advisors?|cfp\b|wealth\s*advisors?)\b/i, label: 'financial advisors' },
  { re: /\b(attorneys?|lawyers?)\b/i, label: 'attorneys' },
  { re: /\b(engineers?|pe\b|professional\s*engineer)\b/i, label: 'engineers' },
  { re: /\b(teachers?|educators?|k-12)\b/i, label: 'teachers' },
];

export const UNIVERSE_NAICS_EXCLUDE_PREFIXES = ['92', '6111', '8131'] as const;

export const GOV_K12_RELIGIOUS_INDUSTRY_RE =
  /\b(government|public\s*administration|public\s*school|school\s*district|k-12|church|religious|ministry|diocese|synagogue|mosque)\b/i;

export const EPA_DROP_NAME_RE = /\b(superfund|vacant(\s+lot)?|abandoned|undeveloped)\b/i;

export const FSQ_KEEP_CATEGORY_RE =
  /\b(manufactur|warehouse|wholesale|industrial|distribution|office|corporate|factory|plant|contractor|construction|software|saas|b2b)\b/i;

export const FSQ_DROP_CATEGORY_RE =
  /\b(restaurant|bar|cafe|coffee|park|hotel|motel|church|school|retail|grocery|gas\s*station|nightlife|salon|gym)\b/i;

export const CLASSIFY_PROMPT_VERSION = 'wasatch-classify-v3';
export const WEBINAR_PURPOSE_PROMPT_VERSION = 'wasatch-webinar-purpose-v1';

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';

export const EPA_COUNTY_QUERIES = [
  { county_name: 'Salt Lake', fips: '49035' },
  { county_name: 'Utah', fips: '49049' },
  { county_name: 'Davis', fips: '49011' },
] as const;

export const FRS_GET_FACILITIES_URL = 'https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities';

export const CENSUS_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
export const CENSUS_REVERSE_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
