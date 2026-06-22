import {
  detectAutoReplyRedirectSignals,
  extractReferralNamePhraseNearEmail,
  resolveSuggestedReferralName,
} from './autoReplyRedirectDetection';

export type ReferralContactField =
  | 'email'
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'phoneNumber'
  | 'title';

export type FieldConfidence = 'high' | 'low';

export type SparseReferralContact = Partial<Record<ReferralContactField, string>>;
export type ReferralContactConfidence = Partial<Record<ReferralContactField, FieldConfidence>>;

export type ReferralContactExtractionResult = {
  fields: SparseReferralContact;
  confidence: ReferralContactConfidence;
  filledFields: ReferralContactField[];
};

export type SuggestedReferralReason = 'auto_reply_forward' | 'manual_referral' | 'wrong_contact';

const SUPPORT_TEAM_PATTERN = /\b(support|customer service|help desk|service team)\b/i;
const MAX_PERSON_NAME_LENGTH = 60;
const MAX_PERSON_NAME_TOKENS = 4;
const MAX_TITLE_LENGTH = 80;

export function splitPersonName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = fullName?.trim() ?? '';
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function isHighConfidencePersonName(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  if (trimmed.length > MAX_PERSON_NAME_LENGTH) return false;
  if (trimmed.includes('@')) return false;
  if (/\d/.test(trimmed)) return false;
  if (/[(\[,]\s*$/.test(trimmed)) return false;
  if (SUPPORT_TEAM_PATTERN.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0 || tokens.length > MAX_PERSON_NAME_TOKENS) return false;

  return true;
}

function isHighConfidenceTitle(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) return false;
  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  if (digitCount > 2) return false;
  return true;
}

function extractPhoneNearEmail(bodyText: string, referralEmail: string): string | null {
  const emailIndex = bodyText.toLowerCase().indexOf(referralEmail.toLowerCase());
  if (emailIndex < 0) return null;

  const start = Math.max(0, emailIndex - 200);
  const end = Math.min(bodyText.length, emailIndex + referralEmail.length + 200);
  const window = bodyText.slice(start, end);
  const matches = window.match(/(?:\+?\d[\d\s().-]{8,}\d)/g) ?? [];

  for (const raw of matches) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      return raw.trim();
    }
  }
  return null;
}

function extractTitleFromNamePhrase(rawNamePhrase: string): string | null {
  const commaSplit = rawNamePhrase.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaSplit.length >= 2) {
    const title = commaSplit.slice(1).join(', ').trim();
    return isHighConfidenceTitle(title) ? title : null;
  }

  const dashSplit = rawNamePhrase.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashSplit.length >= 2) {
    const title = dashSplit.slice(1).join(' - ').trim();
    return isHighConfidenceTitle(title) ? title : null;
  }

  return null;
}

function extractRawNamePhrase(
  bodyText: string | null | undefined,
  referralEmail: string | null | undefined,
): string | null {
  return extractReferralNamePhraseNearEmail(bodyText, referralEmail);
}

function stripTitleFromNamePhrase(rawPhrase: string): string {
  const commaIndex = rawPhrase.indexOf(',');
  if (commaIndex > 0) return rawPhrase.slice(0, commaIndex).trim();

  const dashMatch = rawPhrase.match(/^(.+?)\s+-\s+/);
  if (dashMatch) return dashMatch[1].trim();

  return rawPhrase.trim();
}

export function extractReferralContactHeuristic(params: {
  bodyText?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  leadEmail?: string | null;
}): ReferralContactExtractionResult {
  const bodyText = params.bodyText ?? '';
  const redirect = detectAutoReplyRedirectSignals({
    fromEmail: params.fromEmail,
    leadEmail: params.leadEmail,
    bodyText,
  });

  const fields: SparseReferralContact = {};
  const confidence: ReferralContactConfidence = {};
  const filledFields: ReferralContactField[] = [];

  const addField = (field: ReferralContactField, value: string) => {
    fields[field] = value;
    confidence[field] = 'high';
    filledFields.push(field);
  };

  if (redirect.referralEmail) {
    addField('email', redirect.referralEmail);
  } else if (redirect.headerMismatch) {
    const fromEmail = params.fromEmail?.trim().toLowerCase();
    if (fromEmail) addField('email', fromEmail);
  }

  const rawNamePhrase = redirect.referralEmail
    ? extractRawNamePhrase(bodyText, redirect.referralEmail)
    : null;
  const titleFromPhrase = rawNamePhrase ? extractTitleFromNamePhrase(rawNamePhrase) : null;

  let personName = resolveSuggestedReferralName({
    referralEmail: redirect.referralEmail,
    referralName: redirect.referralName,
    headerMismatch: redirect.headerMismatch,
    fromName: params.fromName ?? null,
  });

  if (rawNamePhrase) {
    const nameWithoutTitle = stripTitleFromNamePhrase(rawNamePhrase);
    if (isHighConfidencePersonName(nameWithoutTitle)) {
      personName = nameWithoutTitle;
    }
  }

  if (personName && isHighConfidencePersonName(personName)) {
    addField('name', personName);
    const { firstName, lastName } = splitPersonName(personName);
    if (firstName) addField('firstName', firstName);
    if (lastName) addField('lastName', lastName);
  }

  if (titleFromPhrase && isHighConfidenceTitle(titleFromPhrase)) {
    addField('title', titleFromPhrase);
  }

  if (redirect.referralEmail) {
    const phone = extractPhoneNearEmail(bodyText, redirect.referralEmail);
    if (phone) addField('phoneNumber', phone);
  }

  return { fields, confidence, filledFields };
}

export function buildSuggestedReferralFromExtraction(
  extraction: ReferralContactExtractionResult,
  reason: SuggestedReferralReason,
): Record<string, unknown> {
  const suggested: Record<string, unknown> = { reason };

  for (const field of extraction.filledFields) {
    const value = extraction.fields[field];
    if (value) suggested[field] = value;
  }

  if (extraction.filledFields.length > 0) {
    suggested.confidence = { ...extraction.confidence };
    suggested.filledFields = [...extraction.filledFields];
  }

  return suggested;
}

export function matchTitleCustomFieldKey(customLeadDataKeys: string[]): string | null {
  for (const key of customLeadDataKeys) {
    if (/^(job\s*)?title$/i.test(key.trim())) return key;
  }
  return null;
}

export function mapTitleToCustomFields(
  title: string | null | undefined,
  customLeadDataKeys: string[],
): Record<string, string> | undefined {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  const key = matchTitleCustomFieldKey(customLeadDataKeys);
  if (!key) return undefined;
  return { [key]: trimmed };
}

export function referralHasHighConfidenceName(
  referral: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    confidence?: ReferralContactConfidence | null;
  } | null | undefined,
): boolean {
  if (!referral) return false;

  const confidence = referral.confidence ?? null;
  if (confidence) {
    return (
      confidence.firstName === 'high' ||
      confidence.lastName === 'high' ||
      confidence.name === 'high'
    );
  }

  return Boolean(referral.firstName?.trim() || referral.lastName?.trim() || referral.name?.trim());
}
