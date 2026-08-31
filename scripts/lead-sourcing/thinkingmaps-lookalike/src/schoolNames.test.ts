import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bareSchoolName, canonicalSchoolName, schoolHintFromHost } from './schoolNames.js';

describe('canonicalSchoolName', () => {
  it('aligns CRM school names with NCES names', () => {
    assert.equal(
      canonicalSchoolName('Palm Tree Elementary', 'CA'),
      canonicalSchoolName('Palm Tree Elementary School', 'CA'),
    );
    assert.equal(canonicalSchoolName('Palmdale High', 'CA'), canonicalSchoolName('Palmdale High School', 'CA'));
    assert.equal(
      canonicalSchoolName('Heartland Charter School', 'CA'),
      canonicalSchoolName('Heartland Charter', 'CA'),
    );
    assert.equal(bareSchoolName('Palm Tree Elementary School', 'CA'), 'palm tree');
    assert.equal(canonicalSchoolName('Suder Es', 'GA'), canonicalSchoolName('Suder Elementary', 'GA'));
    assert.equal(canonicalSchoolName('Mt Zion Hs', 'GA'), canonicalSchoolName('Mt Zion High School', 'GA'));
    assert.equal(canonicalSchoolName('Mt Zion Pri', 'GA'), canonicalSchoolName('Mt Zion Primary', 'GA'));
    assert.equal(canonicalSchoolName('Morrow Jhs', 'GA'), canonicalSchoolName('Morrow Junior High', 'GA'));
    assert.equal(schoolHintFromHost('https://rae.katyisd.org/directory', 'https://www.katyisd.org/'), 'rae');
  });
});
