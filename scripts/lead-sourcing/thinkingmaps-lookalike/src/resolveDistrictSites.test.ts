import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isJunkHost,
  pickDistrictWebsite,
  scoreWebsiteCandidate,
  serperQueryForDistrict,
  verifiedSeeds,
  type DistrictSiteInput,
} from './resolveDistrictSites.js';

const palmdale: DistrictSiteInput = {
  leaid: '0629640',
  lea_name: 'Palmdale School District',
  state: 'CA',
  email_domain: 'palmdalesd.org',
};

describe('resolveDistrictSites scoring', () => {
  it('drops ranking-site hosts and prefers the official org domain', () => {
    const picked = pickDistrictWebsite(palmdale, [
      {
        url: 'https://www.niche.com/k12/d/palmdale-school-district-ca/',
        title: 'Palmdale SD - Niche',
        snippet: 'Rankings',
        position: 1,
        source: 'organic',
      },
      {
        url: 'https://www.palmdalesd.org/',
        title: 'Palmdale School District',
        snippet: 'Official site',
        position: 2,
        source: 'organic',
      },
    ]);
    assert.equal(picked.host, 'palmdalesd.org');
    assert.equal(picked.confidence, 'high');
    assert.equal(picked.needs_review, false);
  });

  it('does not treat an unrelated email domain as a confident website', () => {
    const baldwin: DistrictSiteInput = {
      leaid: '0603690',
      lea_name: 'Baldwin Park Unified',
      state: 'CA',
      email_domain: 'sowashco.org',
    };
    const { score } = scoreWebsiteCandidate(
      {
        url: 'https://www.sowashco.org/',
        title: 'SoWashCo Schools',
        snippet: 'Minnesota',
        position: 1,
        source: 'furnace_email',
      },
      baldwin,
    );
    assert.ok(score < 0.55, `expected low score, got ${score}`);
  });

  it('builds a serper query with the district name and state', () => {
    assert.equal(
      serperQueryForDistrict(palmdale),
      '"Palmdale School District" CA school district official site',
    );
  });

  it('does not seed CDE directory pages as district websites', () => {
    assert.equal(isJunkHost('cde.ca.gov'), true);
    assert.equal(isJunkHost('newsroom.ccsd.net'), true);
    assert.equal(isJunkHost('its.lausd.org'), true);
    const ararat = verifiedSeeds().find((row) => /ararat/i.test(row.lookupName));
    assert.ok(ararat);
    assert.equal(ararat?.host.includes('cde.ca.gov'), false);
    assert.ok(ararat?.host.includes('ararat'));
  });

  it('overrides known wrong district hosts', () => {
    const lausd: DistrictSiteInput = {
      leaid: '0622710',
      lea_name: 'Los Angeles Unified',
      state: 'CA',
      email_domain: '',
    };
    const picked = pickDistrictWebsite(lausd, [
      {
        url: 'https://www.its.lausd.org/',
        title: 'IT Services',
        snippet: '',
        position: 1,
        source: 'organic',
      },
    ]);
    assert.equal(picked.host, 'lausd.org');
    assert.equal(picked.source, 'override');
  });
});
