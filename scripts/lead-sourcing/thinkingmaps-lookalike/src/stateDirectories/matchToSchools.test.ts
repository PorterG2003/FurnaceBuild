import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchStateRow, matchToSchools } from './matchToSchools.js';
import type { ListedSchool } from '../types.js';
import type { StateDirectoryRow } from './types.js';

function school(partial: Partial<ListedSchool> & Pick<ListedSchool, 'ncessch' | 'school_name'>): ListedSchool {
  return {
    leaid: '0622710',
    state: 'CA',
    city: 'Los Angeles',
    zip: '90001',
    lea_name: 'Los Angeles Unified',
    excluded: false,
    exclude_reason: '',
    won_account_id: '',
    won_account_name: '',
    match_confidence: '',
    match_score: '',
    ...partial,
  };
}

function row(partial: Partial<StateDirectoryRow>): StateDirectoryRow {
  return {
    source_state: 'CA',
    state_school_id: '1',
    nces_school_id: '',
    district_name: 'Los Angeles Unified',
    school_name: 'Suder Elementary',
    city: 'Los Angeles',
    zip: '90001',
    first_name: 'Jane',
    last_name: 'Doe',
    title: 'Principal',
    email: '',
    ...partial,
  };
}

describe('matchToSchools', () => {
  it('matches on NCES id without fuzzy scoring', () => {
    const schools = [
      school({ ncessch: '062271000123', school_name: 'Suder Elementary' }),
      school({ ncessch: '062271000999', school_name: 'Other Elementary', city: 'Long Beach' }),
    ];
    const hit = matchStateRow(row({ nces_school_id: '062271000123', school_name: 'Completely Different Name' }), schools);
    assert.equal(hit.status, 'matched');
    assert.equal(hit.method, 'nces');
    assert.equal(hit.school?.ncessch, '062271000123');
  });

  it('uses a fuzzy fallback for Es abbreviations', () => {
    const schools = [school({ ncessch: '062271000123', school_name: 'Suder Elementary' })];
    const hit = matchStateRow(row({ school_name: 'Suder Es', nces_school_id: '' }), schools);
    assert.equal(hit.status, 'matched');
    assert.ok(hit.method === 'exact' || hit.method === 'bare' || hit.method === 'jaccard' || hit.method === 'city');
    assert.equal(hit.school?.ncessch, '062271000123');
  });

  it('marks two close schools as ambiguous', () => {
    const schools = [
      school({ ncessch: '062271000001', school_name: 'Washington Elementary', city: 'A' }),
      school({ ncessch: '062271000002', school_name: 'Washington Elementary', city: 'B' }),
    ];
    const hit = matchStateRow(row({ school_name: 'Washington Elementary', city: '', zip: '', nces_school_id: '' }), schools);
    assert.equal(hit.status, 'ambiguous');
  });

  it('leaves unmatched junk unmatched', () => {
    const schools = [school({ ncessch: '062271000123', school_name: 'Suder Elementary' })];
    const results = matchToSchools([row({ school_name: 'Completely Unrelated Magnet Academy of Rocketry' })], schools);
    assert.equal(results[0]!.match_status, 'unmatched');
    assert.equal(results[0]!.ncessch, '');
  });
});
