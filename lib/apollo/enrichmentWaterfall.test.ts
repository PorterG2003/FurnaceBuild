import test from 'node:test';
import assert from 'node:assert/strict';
import { ApolloError, type ApolloPerson } from './apolloClient';
import {
  creditPlanForOutcome,
  prospeoModeForTrigger,
  runEnrichmentWaterfallSync,
  runEnrichmentWaterfallWebhook,
  shouldFallbackToProspeo,
  type LeadContactKeys,
} from './enrichmentWaterfall';
import { ProspeoError, type ProspeoEnrichResponse } from '../prospeo/prospeoClient';

const CONTACT: LeadContactKeys = {
  email: 'jane@acme.com',
  linkedinUrl: 'https://linkedin.com/in/jane',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme',
  companyWebsite: 'acme.com',
};

const APOLLO_PERSON: ApolloPerson = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  linkedin_url: 'https://linkedin.com/in/jane',
  organization: { name: 'Acme', website_url: 'https://acme.com' },
};

const PROSPEO_WITH_MOBILE: ProspeoEnrichResponse = {
  error: false,
  person: {
    first_name: 'Jane',
    last_name: 'Doe',
    full_name: 'Jane Doe',
    linkedin_url: 'https://linkedin.com/in/jane',
    current_job_title: 'CEO',
    mobile: { revealed: true, mobile: '+15551234567' },
  },
  company: { name: 'Acme', website: 'https://acme.com' },
};

const PROSPEO_NO_MOBILE: ProspeoEnrichResponse = {
  error: false,
  person: {
    first_name: 'Jane',
    last_name: 'Doe',
    linkedin_url: 'https://linkedin.com/in/jane',
    mobile: { revealed: false, mobile: '+1 ***-***-****' },
  },
  company: { name: 'Acme' },
};

test('shouldFallbackToProspeo is true for any Apollo error', () => {
  assert.equal(shouldFallbackToProspeo(new ApolloError('boom', 422)), true);
  assert.equal(shouldFallbackToProspeo(new Error('network')), true);
});

test('prospeoModeForTrigger: phone_only uses only_verified_mobile; full does not', () => {
  assert.deepEqual(prospeoModeForTrigger('phone_only'), {
    enrichMobile: true,
    onlyVerifiedMobile: true,
  });
  assert.deepEqual(prospeoModeForTrigger('full'), {
    enrichMobile: true,
    onlyVerifiedMobile: false,
  });
});

test('creditPlanForOutcome covers match and fallback amounts', () => {
  assert.deepEqual(creditPlanForOutcome('apollo_match'), {
    amount: 1,
    reason: 'apollo_person_match',
  });
  assert.deepEqual(creditPlanForOutcome('prospeo_full_match'), {
    amount: 1,
    reason: 'prospeo_person_match',
  });
  assert.deepEqual(creditPlanForOutcome('prospeo_phone_fallback_hit'), {
    amount: 0,
    reason: 'prospeo_phone_fallback',
  });
});

test('1. Apollo match → charge 1, pending phone, no Prospeo call', async () => {
  let prospeoCalls = 0;
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => APOLLO_PERSON,
    enrichProspeo: async () => {
      prospeoCalls += 1;
      return null;
    },
  });

  assert.equal(result.kind, 'apollo_match');
  assert.equal(result.sessionStatus, 'pending_phone');
  assert.equal(result.phonePending, true);
  assert.equal(result.profileSource, 'apollo');
  assert.equal(result.phoneSource, null);
  assert.deepEqual(result.credit, { amount: 1, reason: 'apollo_person_match' });
  assert.equal(result.prospeoCalled, false);
  assert.equal(prospeoCalls, 0);
  assert.equal(result.suggestion?.first_name, 'Jane');
});

test('2. Apollo match + webhook phones → complete, phone_source apollo, no Prospeo', async () => {
  let prospeoCalls = 0;
  const result = await runEnrichmentWaterfallWebhook({
    apolloPhones: [{ sanitized_number: '+15557654321' }],
    contact: CONTACT,
    enrichProspeo: async () => {
      prospeoCalls += 1;
      return null;
    },
  });

  assert.equal(result.sessionStatus, 'complete');
  assert.equal(result.phoneSource, 'apollo');
  assert.equal(result.prospeoCalled, false);
  assert.equal(prospeoCalls, 0);
  assert.deepEqual(result.credit, { amount: 0, reason: 'apollo_phone_webhook' });
});

test('3. Apollo match + webhook no phone + Prospeo mobile → complete, amount 0', async () => {
  let capturedMode: { enrichMobile?: boolean; onlyVerifiedMobile?: boolean } | undefined;
  const result = await runEnrichmentWaterfallWebhook({
    apolloPhones: [],
    contact: CONTACT,
    enrichProspeo: async (input) => {
      capturedMode = {
        enrichMobile: input.enrichMobile,
        onlyVerifiedMobile: input.onlyVerifiedMobile,
      };
      return PROSPEO_WITH_MOBILE;
    },
  });

  assert.equal(result.sessionStatus, 'complete');
  assert.equal(result.phoneSource, 'prospeo');
  assert.equal(result.mobilePhoneNumber, '+15551234567');
  assert.equal(result.prospeoCalled, true);
  assert.deepEqual(result.credit, { amount: 0, reason: 'prospeo_phone_fallback' });
  assert.deepEqual(capturedMode, { enrichMobile: true, onlyVerifiedMobile: true });
});

test('4. Apollo match + webhook no phone + Prospeo miss → no_phone, amount 0', async () => {
  const result = await runEnrichmentWaterfallWebhook({
    apolloPhones: [],
    contact: CONTACT,
    enrichProspeo: async () => null,
  });

  assert.equal(result.sessionStatus, 'no_phone');
  assert.equal(result.phoneSource, null);
  assert.equal(result.prospeoCalled, true);
  assert.deepEqual(result.credit, { amount: 0, reason: 'prospeo_phone_fallback_miss' });
});

test('5a. Apollo no_match + Prospeo match with mobile → charge 1, phonePending false', async () => {
  let capturedMode: { enrichMobile?: boolean; onlyVerifiedMobile?: boolean } | undefined;
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => null,
    enrichProspeo: async (input) => {
      capturedMode = {
        enrichMobile: input.enrichMobile,
        onlyVerifiedMobile: input.onlyVerifiedMobile,
      };
      return PROSPEO_WITH_MOBILE;
    },
  });

  assert.equal(result.kind, 'prospeo_match');
  assert.equal(result.sessionStatus, 'complete');
  assert.equal(result.phonePending, false);
  assert.equal(result.profileSource, 'prospeo');
  assert.equal(result.phoneSource, 'prospeo');
  assert.deepEqual(result.credit, { amount: 1, reason: 'prospeo_person_match' });
  assert.deepEqual(capturedMode, { enrichMobile: true, onlyVerifiedMobile: false });
  assert.equal(result.suggestion?.mobile_phone_number, '+15551234567');
});

test('5b. Apollo no_match + Prospeo match without mobile → charge 1, no_phone', async () => {
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => null,
    enrichProspeo: async () => PROSPEO_NO_MOBILE,
  });

  assert.equal(result.kind, 'prospeo_match');
  assert.equal(result.sessionStatus, 'no_phone');
  assert.equal(result.phonePending, false);
  assert.equal(result.phoneSource, null);
  assert.deepEqual(result.credit, { amount: 1, reason: 'prospeo_person_match' });
});

test('6. Apollo no_match + Prospeo no_match → no_match, amount 0', async () => {
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => null,
    enrichProspeo: async () => null,
  });

  assert.equal(result.kind, 'no_match');
  assert.equal(result.sessionStatus, 'no_match');
  assert.deepEqual(result.credit, { amount: 0, reason: 'prospeo_no_match' });
  assert.equal(result.prospeoCalled, true);
});

test('7. Apollo upstream credit/error + Prospeo match → charge 1 (Apollo never charged)', async () => {
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => {
      throw new ApolloError('Apollo request failed: 422', 422);
    },
    enrichProspeo: async () => PROSPEO_WITH_MOBILE,
  });

  assert.equal(result.kind, 'prospeo_match');
  assert.equal(result.sessionStatus, 'complete');
  assert.deepEqual(result.credit, { amount: 1, reason: 'prospeo_person_match' });
  assert.equal(result.apolloCalled, true);
  assert.equal(result.prospeoCalled, true);
});

test('8. Apollo error + Prospeo INSUFFICIENT_CREDITS → failed / PROVIDERS_OUT_OF_CREDITS', async () => {
  const result = await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/sessions/s1',
    enrichApollo: async () => {
      throw new ApolloError('Apollo request failed: 429', 429);
    },
    enrichProspeo: async () => {
      throw new ProspeoError('out', 400, 'INSUFFICIENT_CREDITS');
    },
  });

  assert.equal(result.kind, 'failed');
  assert.equal(result.sessionStatus, 'failed');
  assert.equal(result.errorCode, 'PROVIDERS_OUT_OF_CREDITS');
  assert.deepEqual(result.credit, { amount: 0, reason: 'prospeo_error' });
});

test('9. phone-only path uses only_verified_mobile; full path does not', async () => {
  const fullMode = prospeoModeForTrigger('full');
  const phoneMode = prospeoModeForTrigger('phone_only');
  assert.equal(fullMode.onlyVerifiedMobile, false);
  assert.equal(phoneMode.onlyVerifiedMobile, true);

  let syncModeOnlyVerified: boolean | undefined;
  await runEnrichmentWaterfallSync({
    contact: CONTACT,
    webhookUrl: 'https://example.com/s',
    enrichApollo: async () => null,
    enrichProspeo: async (input) => {
      syncModeOnlyVerified = input.onlyVerifiedMobile === true;
      return null;
    },
  });
  assert.equal(syncModeOnlyVerified, false);

  let webhookModeOnlyVerified: boolean | undefined;
  await runEnrichmentWaterfallWebhook({
    apolloPhones: [],
    contact: CONTACT,
    enrichProspeo: async (input) => {
      webhookModeOnlyVerified = input.onlyVerifiedMobile === true;
      return null;
    },
  });
  assert.equal(webhookModeOnlyVerified, true);
});
