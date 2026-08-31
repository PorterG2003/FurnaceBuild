import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLookups,
  isMegaDistrictName,
  isTestAccount,
  isVagueParent,
  looksPrivateOrCharter,
  parseAccountRow,
  websiteQuery,
} from './lookups.js';

describe('lookups', () => {
  it('skips test accounts and shares one district lookup across schools', () => {
    const rows = [
      parseAccountRow({
        'Account Name': 'Del Rosa Elementary',
        'Parent Account': 'San Bernardino City Unified School District',
        'Billing City': 'San Bernardino',
        'Billing State': 'CA',
      }),
      parseAccountRow({
        'Account Name': 'Bradley Elementary',
        'Parent Account': 'San Bernardino City Unified School District',
        'Billing City': 'San Bernardino',
        'Billing State': 'CA',
      }),
      parseAccountRow({
        'Account Name': 'JP TEST ACCOUNT',
        'Parent Account': 'No Parent Account',
        'Billing City': 'Cary',
        'Billing State': 'NC',
      }),
    ];
    const { accounts, lookups } = buildLookups(rows);
    assert.equal(accounts.filter((a) => a.skipped).length, 1);
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0]?.kind, 'district');
    assert.equal(lookups[0]?.name, 'San Bernardino City Unified School District');
    assert.equal(accounts[0]?.district_lookup_key, lookups[0]?.lookup_key);
    assert.equal(accounts[1]?.district_lookup_key, lookups[0]?.lookup_key);
  });

  it('queues school lookups for vague parents, standalones, and charters', () => {
    const rows = [
      parseAccountRow({
        'Account Name': 'Pinecrest Academy of Northern Nevada',
        'Parent Account': 'State Sponsored Charter Schools (NV)',
        'Billing City': 'Sparks',
        'Billing State': 'NV',
      }),
      parseAccountRow({
        'Account Name': 'Alpine District',
        'Parent Account': 'No Parent Account',
        'Billing City': 'American Fork',
        'Billing State': 'UT',
      }),
      parseAccountRow({
        'Account Name': 'Encino Charter Elementary',
        'Parent Account': 'Los Angeles Unified',
        'Billing City': 'San Fernando Valley',
        'Billing State': 'CA',
      }),
    ];
    const { accounts, lookups } = buildLookups(rows);
    const kinds = lookups.map((l) => l.lookup_key).sort();
    assert.ok(kinds.some((k) => k.startsWith('school:pinecrest')));
    assert.ok(kinds.some((k) => k.startsWith('org:alpine district')));
    assert.ok(kinds.some((k) => k.startsWith('district:los angeles unified')));
    assert.ok(kinds.some((k) => k.startsWith('school:encino charter')));
    assert.ok(accounts[2]?.district_lookup_key);
    assert.ok(accounts[2]?.school_lookup_key);
  });

  it('classifies mega districts, vague parents, and private/charter names', () => {
    assert.equal(isMegaDistrictName('Los Angeles Unified'), true);
    assert.equal(isMegaDistrictName('Irvine Unified School District'), false);
    assert.equal(isVagueParent('No Parent Account', 'Alpine District'), true);
    assert.equal(isVagueParent('Anderson Creek Academy', 'Anderson Creek Academy'), true);
    assert.equal(isVagueParent('Irvine Unified School District', 'Turtle Rock Elementary'), false);
    assert.equal(looksPrivateOrCharter('Encino Charter Elementary'), true);
    assert.equal(looksPrivateOrCharter('Annunciation Catholic Academy'), true);
    assert.equal(looksPrivateOrCharter('Del Rosa Elementary'), false);
    assert.equal(isTestAccount('Test District Account'), true);
  });

  it('builds a location-aware Serper query', () => {
    assert.equal(
      websiteQuery({
        lookup_key: 'district:sbcusd',
        kind: 'district',
        name: 'San Bernardino City Unified School District',
        city: 'San Bernardino',
        state: 'CA',
        mega: false,
      }),
      '"San Bernardino City Unified School District" San Bernardino CA official school district website',
    );
  });
});
