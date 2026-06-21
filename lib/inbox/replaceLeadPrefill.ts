import type { ReplacementReason } from '@/lib/supabase/types';
import {
  isHighConfidencePersonName,
  mapTitleToCustomFields,
  splitPersonName,
  type ReferralContactField,
} from './referralContactExtraction';
import type { SmartHandlingMetadata, SmartHandlingSuggestedReferral } from './smartHandling';

export interface ReplaceLeadPrefill {
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  reason?: ReplacementReason | null;
  reasonNote?: string | null;
  customFields?: Record<string, string>;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isHighConfidenceReferralField(
  referral: SmartHandlingSuggestedReferral,
  field: ReferralContactField,
): boolean {
  const confidence = referral.confidence;
  if (confidence && confidence[field]) {
    return confidence[field] === 'high';
  }

  const legacyValue = referral[field];
  return typeof legacyValue === 'string' && legacyValue.trim().length > 0;
}

function readHighConfidenceField(
  referral: SmartHandlingSuggestedReferral,
  field: ReferralContactField,
): string | null {
  if (!isHighConfidenceReferralField(referral, field)) return null;
  return normalizeNullableString(referral[field]);
}

export function buildReplaceLeadPrefill(params: {
  metadata: SmartHandlingMetadata | null;
  inboundFromEmail?: string | null;
  inboundFromName?: string | null;
  customLeadDataKeys?: string[];
}): ReplaceLeadPrefill | null {
  const { metadata, inboundFromEmail, inboundFromName, customLeadDataKeys = [] } = params;
  if (!metadata) return null;

  const referral = metadata.suggested_referral ?? null;
  const referralEmail = referral ? readHighConfidenceField(referral, 'email') : null;
  const fallbackEmail = metadata.header_mismatch ? normalizeNullableString(inboundFromEmail) : null;
  const email = referralEmail ?? fallbackEmail;

  const prefill: ReplaceLeadPrefill = {};
  if (email) prefill.email = email;

  const name = referral ? readHighConfidenceField(referral, 'name') : null;
  const firstName = referral ? readHighConfidenceField(referral, 'firstName') : null;
  const lastName = referral ? readHighConfidenceField(referral, 'lastName') : null;
  const phoneNumber = referral ? readHighConfidenceField(referral, 'phoneNumber') : null;

  if (name) prefill.name = name;
  if (firstName) prefill.firstName = firstName;
  if (lastName) prefill.lastName = lastName;
  if (phoneNumber) prefill.phoneNumber = phoneNumber;

  if (!prefill.firstName && !prefill.lastName && prefill.name) {
    const split = splitPersonName(prefill.name);
    if (split.firstName) prefill.firstName = split.firstName;
    if (split.lastName) prefill.lastName = split.lastName;
  }

  if (
    metadata.header_mismatch &&
    !referralEmail &&
    !prefill.name &&
    !prefill.firstName &&
    !prefill.lastName
  ) {
    const inboundName = normalizeNullableString(inboundFromName);
    if (inboundName && isHighConfidencePersonName(inboundName)) {
      prefill.name = inboundName;
      const split = splitPersonName(inboundName);
      if (split.firstName) prefill.firstName = split.firstName;
      if (split.lastName) prefill.lastName = split.lastName;
    }
  }

  const title = referral ? readHighConfidenceField(referral, 'title') : null;
  const customFields = mapTitleToCustomFields(title, customLeadDataKeys);
  if (customFields) prefill.customFields = customFields;

  const reason =
    referral?.reason ?? (metadata.header_mismatch ? ('wrong_contact' satisfies ReplacementReason) : null);
  const reasonNote = normalizeNullableString(metadata.primary_message);
  if (reason) prefill.reason = reason;
  if (reasonNote) prefill.reasonNote = reasonNote;

  const hasPrefillField =
    prefill.email ||
    prefill.name ||
    prefill.firstName ||
    prefill.lastName ||
    prefill.phoneNumber ||
    prefill.customFields ||
    prefill.reason ||
    prefill.reasonNote;

  return hasPrefillField ? prefill : null;
}
