/**
 * Apollo profile + Prospeo-first phone enrichment waterfall.
 *
 * Profile: Apollo primary, Prospeo full on Apollo miss/error.
 * Phone (Apollo match): Prospeo phone_only first; Apollo phone reveal webhook
 * only when Prospeo has no verified mobile.
 *
 * Pure decision helpers + sync/webhook orchestrators with injected provider
 * clients so the credit/status matrix can be unit-tested without Amplify.
 */

import { ApolloError, type ApolloPerson, type ApolloPhoneNumber } from './apolloClient';
import { mapApolloToProfile, type ApolloProfileSuggestion } from './mapApolloToProfile';
import type { ApolloEnrichmentSessionStatus } from './enrichmentSessionTypes';
import {
  enrichPerson as enrichProspeoPersonDefault,
  ProspeoError,
  type EnrichProspeoPersonInput,
  type ProspeoEnrichResponse,
} from '../prospeo/prospeoClient';
import { mapProspeoToProfile } from '../prospeo/mapProspeoToProfile';

export type EnrichmentProviderSource = 'apollo' | 'prospeo';

export type ProspeoTrigger = 'full' | 'phone_only';

export interface LeadContactKeys {
  email: string | null;
  linkedinUrl: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  companyLinkedinUrl?: string | null;
}

export interface CreditPlan {
  amount: 0 | 1;
  reason: string;
}

export interface ProspeoMode {
  enrichMobile: boolean;
  onlyVerifiedMobile: boolean;
}

/** Any Apollo upstream failure is eligible for Prospeo fallback. */
export function shouldFallbackToProspeo(_apolloError: unknown): boolean {
  return true;
}

export function prospeoModeForTrigger(trigger: ProspeoTrigger): ProspeoMode {
  if (trigger === 'phone_only') {
    return { enrichMobile: true, onlyVerifiedMobile: true };
  }
  return { enrichMobile: true, onlyVerifiedMobile: false };
}

export type CreditOutcomeKind =
  | 'apollo_match'
  | 'prospeo_full_match'
  | 'prospeo_full_no_match'
  | 'prospeo_full_error'
  | 'prospeo_phone'
  | 'prospeo_phone_miss'
  | 'apollo_webhook_phones'
  | 'apollo_phone_miss'
  | 'apollo_no_match_terminal';

export function creditPlanForOutcome(kind: CreditOutcomeKind): CreditPlan {
  switch (kind) {
    case 'apollo_match':
      return { amount: 1, reason: 'apollo_person_match' };
    case 'prospeo_full_match':
      return { amount: 1, reason: 'prospeo_person_match' };
    case 'prospeo_full_no_match':
      return { amount: 0, reason: 'prospeo_no_match' };
    case 'prospeo_full_error':
      return { amount: 0, reason: 'prospeo_error' };
    case 'prospeo_phone':
      return { amount: 0, reason: 'prospeo_phone' };
    case 'prospeo_phone_miss':
      return { amount: 0, reason: 'prospeo_phone_miss' };
    case 'apollo_webhook_phones':
      return { amount: 0, reason: 'apollo_phone_webhook' };
    case 'apollo_phone_miss':
      return { amount: 0, reason: 'apollo_phone_miss' };
    case 'apollo_no_match_terminal':
      return { amount: 0, reason: 'apollo_no_match' };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function hasPhoneNumbers(phones: ApolloPhoneNumber[] | null | undefined): boolean {
  return (phones ?? []).some(
    (p) =>
      (p.sanitized_number && p.sanitized_number.trim() !== '') ||
      (p.raw_number && p.raw_number.trim() !== ''),
  );
}

function toProspeoInput(
  contact: LeadContactKeys,
  mode: ProspeoMode,
): EnrichProspeoPersonInput {
  return {
    email: contact.email,
    linkedinUrl: contact.linkedinUrl,
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: contact.fullName,
    companyName: contact.companyName,
    companyWebsite: contact.companyWebsite,
    companyLinkedinUrl: contact.companyLinkedinUrl,
    enrichMobile: mode.enrichMobile,
    onlyVerifiedMobile: mode.onlyVerifiedMobile,
  };
}

export interface WaterfallSyncResult {
  kind: 'apollo_match' | 'prospeo_match' | 'no_match' | 'failed';
  sessionStatus: ApolloEnrichmentSessionStatus;
  suggestion: ApolloProfileSuggestion | null;
  phoneNumbers: ApolloPhoneNumber[] | null;
  profileSource: EnrichmentProviderSource | null;
  phoneSource: EnrichmentProviderSource | null;
  phonePending: boolean;
  credit: CreditPlan;
  /** Optional 0-amount phone audit after the person-match charge. */
  phoneCredit?: CreditPlan | null;
  errorCode?: string;
  errorMessage?: string;
  apolloCalled: boolean;
  prospeoCalled: boolean;
  prospeoMode?: ProspeoMode;
}

export interface EnrichApolloFn {
  (input: {
    email?: string | null;
    linkedinUrl?: string | null;
    revealPhoneNumber?: boolean;
    webhookUrl?: string | null;
  }): Promise<ApolloPerson | null>;
}

export interface EnrichProspeoFn {
  (input: EnrichProspeoPersonInput): Promise<ProspeoEnrichResponse | null>;
}

async function tryProspeoPhoneOnly(
  contact: LeadContactKeys,
  enrichProspeo: EnrichProspeoFn,
): Promise<{
  hit: boolean;
  phoneNumbers: ApolloPhoneNumber[];
  mobilePhoneNumber: string | null;
  called: boolean;
  mode: ProspeoMode;
}> {
  const mode = prospeoModeForTrigger('phone_only');
  try {
    const prospeo = await enrichProspeo(toProspeoInput(contact, mode));
    if (!prospeo?.person) {
      return { hit: false, phoneNumbers: [], mobilePhoneNumber: null, called: true, mode };
    }
    const mapped = mapProspeoToProfile(prospeo);
    if (!hasPhoneNumbers(mapped.phoneNumbers)) {
      return { hit: false, phoneNumbers: [], mobilePhoneNumber: null, called: true, mode };
    }
    return {
      hit: true,
      phoneNumbers: mapped.phoneNumbers,
      mobilePhoneNumber: mapped.suggestion.mobile_phone_number,
      called: true,
      mode,
    };
  } catch {
    return { hit: false, phoneNumbers: [], mobilePhoneNumber: null, called: true, mode };
  }
}

export async function runEnrichmentWaterfallSync(options: {
  contact: LeadContactKeys;
  webhookUrl: string;
  enrichApollo: EnrichApolloFn;
  enrichProspeo: EnrichProspeoFn;
}): Promise<WaterfallSyncResult> {
  const { contact, webhookUrl, enrichApollo, enrichProspeo } = options;
  let person: ApolloPerson | null = null;

  try {
    person = await enrichApollo({
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      revealPhoneNumber: false,
    });
  } catch (err) {
    if (!shouldFallbackToProspeo(err)) {
      const apolloStatus = err instanceof ApolloError ? err.status : undefined;
      return {
        kind: 'failed',
        sessionStatus: 'failed',
        suggestion: null,
        phoneNumbers: null,
        profileSource: null,
        phoneSource: null,
        phonePending: false,
        credit: { amount: 0, reason: 'apollo_error' },
        errorCode: 'APOLLO_UPSTREAM',
        errorMessage:
          apolloStatus === 401
            ? 'Enrichment service authentication failed. Contact support.'
            : 'Contact lookup failed',
        apolloCalled: true,
        prospeoCalled: false,
      };
    }
  }

  if (person) {
    const suggestion = mapApolloToProfile(person);
    const prospeoPhone = await tryProspeoPhoneOnly(contact, enrichProspeo);

    if (prospeoPhone.hit) {
      return {
        kind: 'apollo_match',
        sessionStatus: 'complete',
        suggestion: {
          ...suggestion,
          mobile_phone_number: prospeoPhone.mobilePhoneNumber,
        },
        phoneNumbers: prospeoPhone.phoneNumbers,
        profileSource: 'apollo',
        phoneSource: 'prospeo',
        phonePending: false,
        credit: creditPlanForOutcome('apollo_match'),
        phoneCredit: creditPlanForOutcome('prospeo_phone'),
        apolloCalled: true,
        prospeoCalled: true,
        prospeoMode: prospeoPhone.mode,
      };
    }

    // Prospeo miss/error → request Apollo phone reveal (async webhook).
    try {
      await enrichApollo({
        email: contact.email,
        linkedinUrl: contact.linkedinUrl,
        revealPhoneNumber: true,
        webhookUrl,
      });
      return {
        kind: 'apollo_match',
        sessionStatus: 'pending_phone',
        suggestion,
        phoneNumbers: null,
        profileSource: 'apollo',
        phoneSource: null,
        phonePending: true,
        credit: creditPlanForOutcome('apollo_match'),
        phoneCredit: prospeoPhone.called
          ? creditPlanForOutcome('prospeo_phone_miss')
          : null,
        apolloCalled: true,
        prospeoCalled: prospeoPhone.called,
        prospeoMode: prospeoPhone.mode,
      };
    } catch {
      return {
        kind: 'apollo_match',
        sessionStatus: 'no_phone',
        suggestion,
        phoneNumbers: null,
        profileSource: 'apollo',
        phoneSource: null,
        phonePending: false,
        credit: creditPlanForOutcome('apollo_match'),
        phoneCredit: creditPlanForOutcome('apollo_phone_miss'),
        apolloCalled: true,
        prospeoCalled: prospeoPhone.called,
        prospeoMode: prospeoPhone.mode,
      };
    }
  }

  // Apollo no-match or fallback-eligible error → Prospeo full enrich.
  const mode = prospeoModeForTrigger('full');
  try {
    const prospeo = await enrichProspeo(toProspeoInput(contact, mode));
    if (!prospeo?.person) {
      return {
        kind: 'no_match',
        sessionStatus: 'no_match',
        suggestion: null,
        phoneNumbers: null,
        profileSource: null,
        phoneSource: null,
        phonePending: false,
        credit: creditPlanForOutcome('prospeo_full_no_match'),
        apolloCalled: true,
        prospeoCalled: true,
        prospeoMode: mode,
      };
    }

    const mapped = mapProspeoToProfile(prospeo);
    const hasPhone = hasPhoneNumbers(mapped.phoneNumbers);
    return {
      kind: 'prospeo_match',
      sessionStatus: hasPhone ? 'complete' : 'no_phone',
      suggestion: mapped.suggestion,
      phoneNumbers: mapped.phoneNumbers,
      profileSource: 'prospeo',
      phoneSource: hasPhone ? 'prospeo' : null,
      phonePending: false,
      credit: creditPlanForOutcome('prospeo_full_match'),
      apolloCalled: true,
      prospeoCalled: true,
      prospeoMode: mode,
    };
  } catch (err) {
    const insufficient =
      err instanceof ProspeoError && err.code === 'INSUFFICIENT_CREDITS';
    return {
      kind: 'failed',
      sessionStatus: 'failed',
      suggestion: null,
      phoneNumbers: null,
      profileSource: null,
      phoneSource: null,
      phonePending: false,
      credit: creditPlanForOutcome('prospeo_full_error'),
      errorCode: insufficient ? 'PROVIDERS_OUT_OF_CREDITS' : 'ENRICH_UPSTREAM',
      errorMessage: insufficient
        ? 'Enrichment providers are out of credits. Contact support.'
        : 'Contact lookup failed',
      apolloCalled: true,
      prospeoCalled: true,
      prospeoMode: mode,
    };
  }
}

export interface WaterfallWebhookResult {
  sessionStatus: ApolloEnrichmentSessionStatus;
  phoneNumbers: ApolloPhoneNumber[];
  phoneSource: EnrichmentProviderSource | null;
  credit: CreditPlan;
}

/** Resolve Apollo webhook phones only (Prospeo already tried in sync). */
export async function runEnrichmentWaterfallWebhook(options: {
  apolloPhones: ApolloPhoneNumber[];
}): Promise<WaterfallWebhookResult> {
  const { apolloPhones } = options;

  if (hasPhoneNumbers(apolloPhones)) {
    return {
      sessionStatus: 'complete',
      phoneNumbers: apolloPhones,
      phoneSource: 'apollo',
      credit: creditPlanForOutcome('apollo_webhook_phones'),
    };
  }

  return {
    sessionStatus: 'no_phone',
    phoneNumbers: apolloPhones,
    phoneSource: null,
    credit: creditPlanForOutcome('apollo_phone_miss'),
  };
}

/** Default Prospeo enrich wrapper matching EnrichProspeoFn. */
export function createDefaultProspeoEnricher(apiKey: string): EnrichProspeoFn {
  return (input) => enrichProspeoPersonDefault(input, { apiKey });
}
