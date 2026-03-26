import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companyDeleteImpactFingerprint,
  isCompanyDeleteSafe,
  isSourceRecordDeleteSafe,
} from './companyDedupe.js';

const emptyCompanyImpact = {
  company_id: '00000000-0000-4000-8000-000000000001',
  current_linked_source_count: 0,
  current_candidate_or_rejected_link_count: 0,
  current_promoted_match_count: 0,
  current_other_match_count: 0,
  location_count: 0,
  sample_linked_source_record_ids: [] as string[],
  sample_match_ids: [] as string[],
  sample_location_ids: [] as string[],
};

test('isCompanyDeleteSafe when no linked sources and no promoted matches', () => {
  assert.equal(isCompanyDeleteSafe(emptyCompanyImpact), true);
  assert.equal(
    isCompanyDeleteSafe({
      ...emptyCompanyImpact,
      current_candidate_or_rejected_link_count: 3,
      current_other_match_count: 2,
      location_count: 1,
    }),
    true,
  );
});

test('isCompanyDeleteSafe false when linked sources or promoted matches', () => {
  assert.equal(
    isCompanyDeleteSafe({ ...emptyCompanyImpact, current_linked_source_count: 1 }),
    false,
  );
  assert.equal(
    isCompanyDeleteSafe({ ...emptyCompanyImpact, current_promoted_match_count: 1 }),
    false,
  );
});

test('companyDeleteImpactFingerprint is stable', () => {
  assert.equal(
    companyDeleteImpactFingerprint({
      ...emptyCompanyImpact,
      current_linked_source_count: 1,
      current_promoted_match_count: 2,
      location_count: 4,
    }),
    'linked:1|cand_links:0|promoted:2|other_matches:0|locs:4',
  );
});

test('isSourceRecordDeleteSafe', () => {
  assert.equal(
    isSourceRecordDeleteSafe({
      source_business_record_id: 'x',
      current_link_count: 0,
      sample_link_ids: [],
    }),
    true,
  );
  assert.equal(
    isSourceRecordDeleteSafe({
      source_business_record_id: 'x',
      current_link_count: 1,
      sample_link_ids: ['l1'],
    }),
    false,
  );
});
