import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bandId, gradeSpanClass, localeClass, loadFeaturesConfig } from './features.js';
import { excludeReasons } from './score.js';
import type { CcdDistrict } from './types.js';

describe('feature bins', () => {
  it('classifies grade span and locale', () => {
    assert.equal(gradeSpanClass(0, 8), 'elementary');
    assert.equal(gradeSpanClass(-1, 6), 'elementary');
    assert.equal(gradeSpanClass(0, 12), 'unified');
    assert.equal(gradeSpanClass(9, 12), 'secondary');
    assert.equal(localeClass(21), 'suburb');
    assert.equal(localeClass(11), 'city');
    assert.equal(localeClass(43), 'rural');
  });

  it('assigns enrollment bands from config', () => {
    const config = loadFeaturesConfig();
    assert.equal(bandId(500, config.enrollment_bands), 'under_1k');
    assert.equal(bandId(20000, config.enrollment_bands), '15k_50k');
    assert.equal(bandId(80000, config.enrollment_bands), '50k_plus');
  });
});

describe('exclusions', () => {
  it('drops customers, avoid-list, and missing enrollment', () => {
    const base: CcdDistrict = {
      leaid: '1',
      lea_name: 'X',
      state: 'CA',
      city: 'A',
      zip: '90000',
      enrollment: 1000,
      english_language_learners: 10,
      spec_ed_students: 10,
      urban_centric_locale: 21,
      agency_type: 1,
      agency_charter_indicator: 3,
      lowest_grade_offered: 0,
      highest_grade_offered: 12,
      number_of_schools: 2,
      teachers_total_fte: 50,
      latitude: 34,
      longitude: -118,
      county_code: '6037',
      poverty_share: 0.1,
    };
    assert.equal(excludeReasons(base, new Set(['1']), new Set()), 'existing_customer');
    assert.equal(excludeReasons({ ...base, leaid: '2' }, new Set(), new Set(['2'])), 'avoid_list');
    assert.equal(excludeReasons({ ...base, enrollment: null }, new Set(), new Set()), 'missing_enrollment');
    assert.equal(excludeReasons({ ...base, leaid: '3' }, new Set(), new Set()), '');
  });
});
