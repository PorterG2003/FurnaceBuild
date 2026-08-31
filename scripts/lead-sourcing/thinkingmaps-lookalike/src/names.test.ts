import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDistrictName, jaccard, tokenSet } from './names.js';

describe('canonicalDistrictName', () => {
  it('maps CRM abbreviations onto NCES-style names', () => {
    assert.equal(canonicalDistrictName('Montebello USD', 'CA'), canonicalDistrictName('Montebello Unified', 'CA'));
    assert.equal(canonicalDistrictName('Santa Ana Unified', 'CA'), canonicalDistrictName('SANTA ANA UNIFIED', 'CA'));
    assert.equal(
      canonicalDistrictName('Chandler Unified District #80 (4242)', 'AZ'),
      canonicalDistrictName('Chandler Unified District (4242)', 'AZ'),
    );
    assert.equal(canonicalDistrictName('Fayette County KY', 'KY'), canonicalDistrictName('Fayette County', 'KY'));
    assert.equal(
      canonicalDistrictName('Delano Union Elementary School District', 'CA'),
      canonicalDistrictName('Delano Union Elementary', 'CA'),
    );
    assert.equal(
      canonicalDistrictName('Pinellas County Public Schools (FL)', 'FL'),
      canonicalDistrictName('Pinellas County Public Schools', 'FL'),
    );
  });

  it('scores token overlap for near-matches', () => {
    const a = tokenSet('Newport-Mesa Unified School District', 'CA');
    const b = tokenSet('Newport-Mesa Unified', 'CA');
    assert.ok(jaccard(a, b) >= 0.99);
  });
});
