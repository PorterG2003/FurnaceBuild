import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildContactEnrichmentFingerprint,
  classifySkipSherpaPersonResult,
  parseContactEnrichmentPersonName,
} from './contactEnrichment.js';

const baseTarget = {
  id: 'target-1',
  foundry_job_id: 'job-1',
  ingestion_run_id: 'run-1',
  source_name: 'google_maps',
  company_id: 'company-1',
  entity_owner_id: 'owner-1',
  owner_name: 'Matt Healy',
  owner_title_role: 'Member',
  first_name: 'Matt',
  last_name: 'Healy',
  company_legal_name: null as string | null,
  address_line_1: '53 S 100 W',
  address_line_2: null,
  address_city: 'Farmington',
  address_state: 'UT',
  address_postal_code: '84025',
  address_country: null,
  lookup_fingerprint: 'fp',
  latest_source_observed_at: null,
};

describe('contact enrichment helpers', () => {
  it('parses comma-separated owner names for person lookup payloads', () => {
    const parsed = parseContactEnrichmentPersonName('Douglas, Brandy S');
    assert.deepEqual(parsed, { firstName: 'Brandy', lastName: 'Douglas' });
  });

  it('builds stable fingerprints for equivalent address formatting', () => {
    const a = buildContactEnrichmentFingerprint({
      source_name: 'google_maps',
      company_id: 'company-1',
      entity_owner_id: 'owner-1',
      first_name: 'Matt',
      last_name: 'Healy',
      address_line_1: '53 S 100 W',
      address_line_2: null,
      address_city: 'Farmington',
      address_state: 'UT',
      address_postal_code: '84025',
    });
    const b = buildContactEnrichmentFingerprint({
      source_name: 'google_maps',
      company_id: 'company-1',
      entity_owner_id: 'owner-1',
      first_name: 'Matt',
      last_name: 'Healy',
      address_line_1: '53 S 100 W ',
      address_line_2: '',
      address_city: 'Farmington',
      address_state: 'UT',
      address_postal_code: '84025',
    });
    assert.equal(a, b);
  });

  it('accepts a strong single-person address-backed result', () => {
    const decision = classifySkipSherpaPersonResult(
      { ...baseTarget },
      {
        status_code: 200,
        expected_results: 1,
        issues: [],
        persons: [
          {
            name: 'Matthew Gary Healy',
            person_name: { first_name: 'Matthew', last_name: 'Healy' },
            addresses: [
              {
                delivery_line1: '53 S 100',
                us_address: { street: '53 S 100', city: 'Farmington', state: 'UT', zipcode: '84025' },
              },
            ],
          },
        ],
      },
    );
    assert.equal(decision.classification, 'accepted_strong_match');
    assert.ok(decision.metadata?.ruleset_version?.startsWith('balanced'));
  });

  it('treats large candidate sets as ambiguous when name-only and weak separation', () => {
    const decision = classifySkipSherpaPersonResult(
      {
        ...baseTarget,
        owner_name: 'Emily Larsen',
        first_name: 'Emily',
        last_name: 'Larsen',
        address_line_1: '180 S Broadway',
        address_city: 'Green River',
        address_postal_code: '84525',
      },
      {
        status_code: 200,
        expected_results: 60,
        issues: [],
        persons: [
          {
            name: 'Emily Larsen',
            person_name: { first_name: 'Emily', last_name: 'Larsen' },
            addresses: [
              {
                delivery_line1: '123 Main St',
                us_address: { street: '123 Main St', city: 'Hurricane', state: 'UT', zipcode: '84737' },
              },
            ],
          },
          {
            name: 'Emily Larsen',
            person_name: { first_name: 'Emily', last_name: 'Larsen' },
            addresses: [
              {
                delivery_line1: '456 Oak Ave',
                us_address: { street: '456 Oak Ave', city: 'Ypsilanti', state: 'MI', zipcode: '48197' },
              },
            ],
          },
        ],
      },
    );
    assert.equal(decision.classification, 'ambiguous');
    assert.ok(decision.metadata?.ambiguity_reason_codes?.includes('high_result_volume'));
  });

  it('auto-accepts when employer matches company legal name despite mediocre address', () => {
    const decision = classifySkipSherpaPersonResult(
      {
        ...baseTarget,
        owner_name: 'Kyle A Houghton',
        first_name: 'Kyle',
        last_name: 'Houghton',
        company_legal_name: 'Acme Dental LLC',
        address_line_1: '100 Main St',
        address_city: 'Salt Lake City',
        address_state: 'UT',
        address_postal_code: '84101',
      },
      {
        status_code: 200,
        expected_results: 12,
        issues: [],
        persons: [
          {
            person_name: { first_name: 'Kyle', middle_name: 'A', last_name: 'Houghton' },
            addresses: [
              {
                us_address: { street: '999 Other Rd', city: 'Provo', state: 'UT', zipcode: '84601' },
              },
            ],
            employers: [{ name: 'Acme Dental LLC', address: {} }],
          },
        ],
      },
      { rulesetPreset: 'balanced' },
    );
    assert.equal(decision.classification, 'accepted_strong_match');
    assert.ok((decision.metadata?.ranked_candidates?.[0]?.breakdown.employer ?? 0) >= 3);
  });

  it('flags reviewable ambiguity when queueAmbiguousForReview is on', () => {
    const addr = {
      us_address: { street: '53 S 100 W', city: 'Farmington', state: 'UT', zipcode: '84025' },
    };
    const decision = classifySkipSherpaPersonResult(
      { ...baseTarget },
      {
        status_code: 200,
        expected_results: 4,
        issues: [],
        persons: [
          {
            person_name: { first_name: 'Matt', last_name: 'Healy' },
            addresses: [addr],
          },
          {
            person_name: { first_name: 'Matthew', last_name: 'Healy' },
            addresses: [addr],
          },
        ],
      },
      { queueAmbiguousForReview: true },
    );
    assert.equal(decision.classification, 'ambiguous');
    assert.equal(decision.metadata?.ambiguity_kind, 'reviewable');
    assert.equal(decision.metadata?.review_task_eligible, true);
  });
});
