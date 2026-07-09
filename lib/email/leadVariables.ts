/**
 * Standard lead variables and helper to build the variable list for the email builder.
 * Only includes standard variables that were mapped (when mappedStandardFieldKeys is set)
 * and custom variables from the lead source.
 */

export type LeadVariable = { token: string; description: string };

export const STANDARD_MERGE_FIELD_KEYS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'source',
] as const;

const STANDARD_LEAD_VARIABLES: { key: string; token: string; description: string }[] = [
  { key: 'email', token: '{{email}}', description: 'Lead email address' },
  { key: 'name', token: '{{name}}', description: 'Full name if available' },
  { key: 'first_name', token: '{{first_name}}', description: 'First name (falls back to name)' },
  { key: 'last_name', token: '{{last_name}}', description: 'Last name' },
  { key: 'company_name', token: '{{company_name}}', description: 'Company name' },
  { key: 'website', token: '{{website}}', description: 'Company website URL' },
  { key: 'linkedin_url', token: '{{linkedin_url}}', description: 'Lead LinkedIn profile' },
  { key: 'company_linkedin_url', token: '{{company_linkedin_url}}', description: 'Company LinkedIn profile' },
  { key: 'source', token: '{{source}}', description: 'Lead source' },
];

/**
 * Build the list of lead variables for the variable menu.
 * - When mappedStandardFieldKeys is undefined (e.g. API-only): include all standard variables.
 * - When mappedStandardFieldKeys is set: include only standard variables whose key is in the array.
 * - Always append one entry per customFieldKeys ({{custom.xyz}}, description "Custom: xyz").
 */
export function getLeadVariables(
  mappedStandardFieldKeys?: string[],
  customFieldKeys?: string[]
): LeadVariable[] {
  const standard =
    mappedStandardFieldKeys === undefined || mappedStandardFieldKeys.length === 0
      ? STANDARD_LEAD_VARIABLES
      : STANDARD_LEAD_VARIABLES.filter((v) => mappedStandardFieldKeys.includes(v.key));

  const standardEntries: LeadVariable[] = standard.map(({ token, description }) => ({
    token,
    description,
  }));

  const customEntries: LeadVariable[] = (customFieldKeys ?? []).map((key) => ({
    token: `{{custom.${key}}}`,
    description: `Custom: ${key}`,
  }));

  return [...standardEntries, ...customEntries];
}
