import type {
  CsvBuilderColumnKind,
  CsvBuilderToolManifest,
  CsvBuilderToolManifestInput,
  CsvBuilderToolManifestOutput,
  CsvBuilderToolType,
} from '../../registry-types.js';

const SOURCE_OR_TOOL_COLUMNS: CsvBuilderColumnKind[] = ['source', 'tool_output'];

const WEBSITE_VERIFICATION_INPUTS: CsvBuilderToolManifestInput[] = [
  {
    key: 'website',
    label: 'Website',
    description: 'Primary website, domain, or URL for the row.',
    required: true,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
  {
    key: 'company_name',
    label: 'Company name',
    description: 'Improves verification quality when present.',
    required: false,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'Used as additional trust evidence when available.',
    required: false,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
  {
    key: 'city',
    label: 'City',
    description: 'Optional geography hint for matching the site to the row.',
    required: false,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
  {
    key: 'state',
    label: 'State',
    description: 'Optional geography hint for matching the site to the row.',
    required: false,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
];

const WEBSITE_VERIFICATION_OUTPUTS: CsvBuilderToolManifestOutput[] = [
  { key: 'band', label: 'Verification band', description: 'Usable, uncertain, or not usable.', data_type: 'text', default_selected: true },
  { key: 'score', label: 'Verification score', description: 'Numeric score from the website verifier.', data_type: 'number', default_selected: false },
  { key: 'input_url', label: 'Input URL', description: 'Canonicalized URL sent to the verifier.', data_type: 'text', default_selected: false },
  { key: 'final_url', label: 'Final URL', description: 'Resolved final URL after redirects.', data_type: 'text', default_selected: true },
  { key: 'reason_summary', label: 'Reason summary', description: 'Short explanation of the verification outcome.', data_type: 'text', default_selected: false },
  { key: 'raw_json', label: 'Raw JSON', description: 'Full structured verifier result for the row.', data_type: 'json', default_selected: false, is_raw_json: true },
];

const GOOGLE_ADS_INPUTS: CsvBuilderToolManifestInput[] = [
  {
    key: 'website',
    label: 'Website',
    description: 'Use a verified final URL when available, otherwise map a raw website or domain.',
    required: true,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
  {
    key: 'company_name',
    label: 'Company name',
    description: 'Optional label for UI review only.',
    required: false,
    accepts_column_kinds: SOURCE_OR_TOOL_COLUMNS,
  },
];

const GOOGLE_ADS_OUTPUTS: CsvBuilderToolManifestOutput[] = [
  { key: 'result', label: 'Google Ads result', description: 'Yes, no, or unknown.', data_type: 'text', default_selected: true },
  {
    key: 'latest_ad_last_shown_at',
    label: 'Latest ad last shown',
    description: 'Date from the first Google Ads creative in Transparency Center results.',
    data_type: 'date',
    default_selected: false,
  },
  { key: 'search_domain', label: 'Search domain', description: 'Normalized domain used for the Transparency Center lookup.', data_type: 'text', default_selected: false },
  { key: 'advertiser_name', label: 'Advertiser name', description: 'Matched advertiser name when available.', data_type: 'text', default_selected: false },
  { key: 'advertiser_url', label: 'Advertiser URL', description: 'Matched advertiser URL when available.', data_type: 'text', default_selected: false },
  { key: 'raw_json', label: 'Raw JSON', description: 'Full structured Google Ads lookup result for the row.', data_type: 'json', default_selected: false, is_raw_json: true },
];

export const CSV_BUILDER_TOOL_MANIFESTS: Record<CsvBuilderToolType, CsvBuilderToolManifest> = {
  website_verification: {
    tool_type: 'website_verification',
    label: 'Website Verification',
    description: 'Verify whether the website appears to belong to the business in this row.',
    supported: true,
    inputs: WEBSITE_VERIFICATION_INPUTS,
    outputs: WEBSITE_VERIFICATION_OUTPUTS,
  },
  google_ads_verification: {
    tool_type: 'google_ads_verification',
    label: 'Google Ads Verification',
    description: 'Check whether the target domain appears in Google Ads Transparency Center results.',
    supported: true,
    inputs: GOOGLE_ADS_INPUTS,
    outputs: GOOGLE_ADS_OUTPUTS,
    dependencies: [{ tool_type: 'website_verification', label: 'Website verification', optional: true }],
  },
  state_matching: {
    tool_type: 'state_matching',
    label: 'State Matching',
    description: 'Reserved for a future builder-aware state matching flow.',
    supported: false,
    inputs: [],
    outputs: [],
  },
  contact_enrichment: {
    tool_type: 'contact_enrichment',
    label: 'Contact Enrichment',
    description: 'Reserved for a future builder-aware contact enrichment flow.',
    supported: false,
    inputs: [],
    outputs: [],
  },
};

export function listCsvBuilderToolManifests(): CsvBuilderToolManifest[] {
  return Object.values(CSV_BUILDER_TOOL_MANIFESTS);
}

export function getCsvBuilderToolManifest(toolType: CsvBuilderToolType): CsvBuilderToolManifest {
  return CSV_BUILDER_TOOL_MANIFESTS[toolType];
}
