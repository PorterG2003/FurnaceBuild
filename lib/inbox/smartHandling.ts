import type { Json } from '../supabase/types/database';

export type SmartHandlingActionId =
  | 'mark_ooo_dated'
  | 'mark_ooo_month'
  | 'mark_ooo_instant'
  | 'mark_ooo_custom'
  | 'mark_not_interested'
  | 'mark_not_interested_block'
  | 'block_sender'
  | 'mark_neutral'
  | 'mark_interested'
  | 'mark_interested_reply'
  | 'reply_only'
  | 'replace_lead'
  | 'close_conversation'
  | 'dismiss';

export type SmartHandlingMode = 'manual' | 'ai';

export interface SmartHandlingActionOption {
  action: SmartHandlingActionId;
  label: string;
}

export type ReferralContactConfidenceLevel = 'high' | 'low';

export interface SmartHandlingSuggestedReferral {
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  title?: string | null;
  reason?: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | null;
  confidence?: Partial<Record<string, ReferralContactConfidenceLevel>> | null;
  filledFields?: string[] | null;
}

export interface SmartHandlingMetadata {
  mode?: SmartHandlingMode;
  suggestion_version?: string | null;
  category?: string | null;
  primary_message?: string | null;
  primary?: SmartHandlingActionOption | null;
  alternatives?: SmartHandlingActionOption[];
  follow_ups?: SmartHandlingActionOption[];
  return_date?: string | null;
  suggested_reply?: string | null;
  suggested_referral?: SmartHandlingSuggestedReferral | null;
  header_mismatch?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseActionOption(value: unknown): SmartHandlingActionOption | null {
  if (!isRecord(value)) return null;
  if (typeof value.action !== 'string' || typeof value.label !== 'string') return null;
  return {
    action: value.action as SmartHandlingActionId,
    label: value.label,
  };
}

function parseActionList(value: unknown): SmartHandlingActionOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseActionOption).filter((item): item is SmartHandlingActionOption => !!item);
}

import { isNotInterestedOptOutRequest } from './notInterestedOptOutDetection';

const OOO_INSTANT_ALTERNATIVE: SmartHandlingActionOption = {
  action: 'mark_ooo_instant',
  label: 'Mark OOO + resume instantly',
};

const OOO_CUSTOM_ALTERNATIVE: SmartHandlingActionOption = {
  action: 'mark_ooo_custom',
  label: 'Choose return date',
};

export function buildOooSmartHandlingOptions(returnDate: string | null): {
  return_date: string | null;
  primary_message: string;
  primary: SmartHandlingActionOption;
  alternatives: SmartHandlingActionOption[];
} {
  const alternatives = [OOO_INSTANT_ALTERNATIVE, OOO_CUSTOM_ALTERNATIVE];

  if (returnDate) {
    return {
      return_date: returnDate,
      primary_message: `Lead may be out of office until ${returnDate}.`,
      primary: { action: 'mark_ooo_dated', label: `Mark OOO until ${returnDate}` },
      alternatives,
    };
  }

  return {
    return_date: null,
    primary_message: 'Lead may be out of office. Choose when to resume outreach.',
    primary: { action: 'mark_ooo_month', label: 'Mark OOO + resume in 1 month' },
    alternatives,
  };
}

export const INTERESTED_SMART_HANDLING_SUGGESTED_REPLY =
  'Thanks for the reply. Happy to share more details and find a time that works for you.';

export const NEUTRAL_SMART_HANDLING_SUGGESTED_REPLY =
  'Thanks for the reply. Happy to circle back whenever the timing is better for you.';

export function buildNeutralSmartHandlingOptions(): {
  primary_message: string;
  primary: SmartHandlingActionOption;
  alternatives: SmartHandlingActionOption[];
  suggested_reply: string;
} {
  return {
    primary_message: 'This reply looks neutral.',
    primary: { action: 'mark_neutral', label: 'Mark neutral' },
    alternatives: [
      { action: 'mark_interested_reply', label: 'Interested + reply' },
      { action: 'mark_not_interested', label: 'Mark not interested' },
    ],
    suggested_reply: NEUTRAL_SMART_HANDLING_SUGGESTED_REPLY,
  };
}

export function getSmartHandlingReplySeed(
  metadata: SmartHandlingMetadata | null | undefined,
  action: SmartHandlingActionId,
): string {
  if (action === 'mark_interested_reply' && metadata?.category === 'Neutral') {
    return INTERESTED_SMART_HANDLING_SUGGESTED_REPLY;
  }
  return metadata?.suggested_reply?.trim() ?? '';
}

export function buildNotInterestedSmartHandlingOptions(params: {
  subject?: string | null;
  bodyText?: string | null;
}): {
  primary_message: string;
  primary: SmartHandlingActionOption;
  alternatives: SmartHandlingActionOption[];
} {
  const requestsOptOut = isNotInterestedOptOutRequest(params);

  if (requestsOptOut) {
    return {
      primary_message: 'This reply asks to be removed from outreach.',
      primary: { action: 'mark_not_interested_block', label: 'Not interested + block list' },
      alternatives: [{ action: 'mark_not_interested', label: 'Mark not interested' }],
    };
  }

  return {
    primary_message: 'This reply looks like a clear not interested.',
    primary: { action: 'mark_not_interested', label: 'Mark not interested' },
    alternatives: [{ action: 'mark_not_interested_block', label: 'Not interested + block list' }],
  };
}

function parseReferralReason(value: unknown): SmartHandlingSuggestedReferral['reason'] {
  if (
    value === 'auto_reply_forward' ||
    value === 'manual_referral' ||
    value === 'wrong_contact'
  ) {
    return value;
  }
  return null;
}

function parseReferralConfidence(value: unknown): SmartHandlingSuggestedReferral['confidence'] {
  if (!isRecord(value)) return null;
  const confidence: NonNullable<SmartHandlingSuggestedReferral['confidence']> = {};
  for (const [key, level] of Object.entries(value)) {
    if (level === 'high' || level === 'low') {
      confidence[key] = level;
    }
  }
  return Object.keys(confidence).length > 0 ? confidence : null;
}

function parseSuggestedReferral(value: unknown): SmartHandlingSuggestedReferral | null {
  if (!isRecord(value)) return null;

  const referral: SmartHandlingSuggestedReferral = {
    reason: parseReferralReason(value.reason),
  };

  if (typeof value.email === 'string') referral.email = value.email;
  if (typeof value.name === 'string') referral.name = value.name;
  if (typeof value.firstName === 'string') referral.firstName = value.firstName;
  if (typeof value.lastName === 'string') referral.lastName = value.lastName;
  if (typeof value.phoneNumber === 'string') referral.phoneNumber = value.phoneNumber;
  if (typeof value.title === 'string') referral.title = value.title;

  const confidence = parseReferralConfidence(value.confidence);
  if (confidence) referral.confidence = confidence;

  if (Array.isArray(value.filledFields)) {
    referral.filledFields = value.filledFields.filter((field): field is string => typeof field === 'string');
  }

  const hasAnyField =
    referral.email != null ||
    referral.name != null ||
    referral.firstName != null ||
    referral.lastName != null ||
    referral.phoneNumber != null ||
    referral.title != null ||
    referral.reason != null;

  return hasAnyField ? referral : null;
}

export function parseSmartHandlingMetadata(value: Json | null | undefined): SmartHandlingMetadata | null {
  if (!isRecord(value)) return null;
  return {
    mode: value.mode === 'ai' || value.mode === 'manual' ? value.mode : undefined,
    suggestion_version: typeof value.suggestion_version === 'string' ? value.suggestion_version : null,
    category: typeof value.category === 'string' ? value.category : null,
    primary_message: typeof value.primary_message === 'string' ? value.primary_message : null,
    primary: parseActionOption(value.primary),
    alternatives: parseActionList(value.alternatives),
    follow_ups: parseActionList(value.follow_ups),
    return_date: typeof value.return_date === 'string' ? value.return_date : null,
    suggested_reply: typeof value.suggested_reply === 'string' ? value.suggested_reply : null,
    suggested_referral: parseSuggestedReferral(value.suggested_referral),
    header_mismatch: value.header_mismatch === true,
  };
}
