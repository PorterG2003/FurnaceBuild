export const CUSTOM_FIELDS_BYTE_BUDGET = 8192;
export const WEBHOOK_BODY_TEXT_MAX_CHARS = 16_000;

export const LEAD_WEBHOOK_IDENTITY_COLUMNS =
  'id, email, first_name, last_name, name, company_name, website, linkedin_url, company_linkedin_url, phone_number, custom_lead_data';

export const LEAD_ACTIVITY_WEBHOOK_EVENTS = [
  'email.sent',
  'reply.received',
  'reply.categorized',
  'bounce.detected',
  'unsubscribe.detected',
] as const;

export type LeadActivityWebhookEvent = (typeof LEAD_ACTIVITY_WEBHOOK_EVENTS)[number];

export type LeadWebhookIdentityInput = {
  campaignId: string;
  campaignName?: string | null;
  leadId: string;
  email?: string | null;
  mailboxId?: string | null;
  mailboxEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  companyLinkedinUrl?: string | null;
  phoneNumber?: string | null;
  customLeadData?: unknown;
};

export type LeadWebhookIdentity = {
  campaign_id: string;
  campaign_name?: string;
  lead_id: string;
  email?: string;
  mailbox_id?: string;
  mailbox_email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company_name?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  company_linkedin_url?: string;
  phone_number?: string;
  custom_fields?: Record<string, string>;
  custom_fields_truncated?: true;
};

export type LeadIdentityRow = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  phone_number?: string | null;
  custom_lead_data?: unknown;
};

function omitEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function stringifyCustomFieldValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return omitEmpty(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isCustomLeadDataObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function promoteLeadTitle(customLeadData: unknown): string | undefined {
  if (!isCustomLeadDataObject(customLeadData)) return undefined;
  const entries = Object.entries(customLeadData);
  const match = (wanted: string) =>
    entries.find(([key, value]) => key.toLowerCase() === wanted && stringifyCustomFieldValue(value));
  const title = match('title') ?? match('job_title');
  return title ? stringifyCustomFieldValue(title[1]) : undefined;
}

export function buildCappedCustomFields(customLeadData: unknown): {
  custom_fields?: Record<string, string>;
  custom_fields_truncated?: true;
} {
  if (!isCustomLeadDataObject(customLeadData)) return {};

  const custom_fields: Record<string, string> = {};
  let truncated = false;

  for (const key of Object.keys(customLeadData).sort()) {
    const value = stringifyCustomFieldValue(customLeadData[key]);
    if (value === undefined) continue;
    const next = { ...custom_fields, [key]: value };
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > CUSTOM_FIELDS_BYTE_BUDGET) {
      truncated = true;
      continue;
    }
    custom_fields[key] = value;
  }

  if (Object.keys(custom_fields).length === 0) return {};
  return truncated ? { custom_fields, custom_fields_truncated: true } : { custom_fields };
}

export function buildLeadWebhookIdentity(input: LeadWebhookIdentityInput): LeadWebhookIdentity {
  const identity: LeadWebhookIdentity = {
    campaign_id: input.campaignId,
    lead_id: input.leadId,
  };

  const optional: Array<[keyof LeadWebhookIdentity, string | undefined]> = [
    ['campaign_name', omitEmpty(input.campaignName)],
    ['email', omitEmpty(input.email)],
    ['mailbox_id', omitEmpty(input.mailboxId)],
    ['mailbox_email', omitEmpty(input.mailboxEmail)],
    ['first_name', omitEmpty(input.firstName)],
    ['last_name', omitEmpty(input.lastName)],
    ['full_name', omitEmpty(input.fullName)],
    ['company_name', omitEmpty(input.companyName)],
    ['title', promoteLeadTitle(input.customLeadData)],
    ['website', omitEmpty(input.website)],
    ['linkedin_url', omitEmpty(input.linkedinUrl)],
    ['company_linkedin_url', omitEmpty(input.companyLinkedinUrl)],
    ['phone_number', omitEmpty(input.phoneNumber)],
  ];

  for (const [key, value] of optional) {
    if (value !== undefined) {
      (identity as Record<string, unknown>)[key] = value;
    }
  }

  Object.assign(identity, buildCappedCustomFields(input.customLeadData));
  return identity;
}

export function leadWebhookIdentityFromRow(input: {
  campaignId: string;
  campaignName?: string | null;
  lead: LeadIdentityRow;
  mailboxId?: string | null;
  mailboxEmail?: string | null;
}): LeadWebhookIdentity {
  return buildLeadWebhookIdentity({
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    leadId: input.lead.id,
    email: input.lead.email,
    mailboxId: input.mailboxId,
    mailboxEmail: input.mailboxEmail,
    firstName: input.lead.first_name,
    lastName: input.lead.last_name,
    fullName: input.lead.name,
    companyName: input.lead.company_name,
    website: input.lead.website,
    linkedinUrl: input.lead.linkedin_url,
    companyLinkedinUrl: input.lead.company_linkedin_url,
    phoneNumber: input.lead.phone_number,
    customLeadData: input.lead.custom_lead_data,
  });
}

export function truncateWebhookBodyText(text: string): string {
  if (text.length <= WEBHOOK_BODY_TEXT_MAX_CHARS) return text;
  return text.slice(0, WEBHOOK_BODY_TEXT_MAX_CHARS);
}

export function composeBounceReason(
  severity: string,
  code?: string | null,
): string {
  const trimmedCode = omitEmpty(code ?? undefined);
  return trimmedCode ? `${severity} ${trimmedCode}` : severity;
}
