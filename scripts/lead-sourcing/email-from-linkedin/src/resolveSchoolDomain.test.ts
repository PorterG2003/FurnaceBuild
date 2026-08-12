import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLikelySchoolDomain, normalizeDomain } from './schoolDomainQuality.js';
import { createSchoolDomainResolver } from './resolveSchoolDomain.js';
import { resolveDomainViaSerper } from './resolveSchoolDomainSerper.js';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';

describe('isLikelySchoolDomain', () => {
  it('accepts k12 and edu domains', () => {
    assert.equal(isLikelySchoolDomain('heard.k12.ga.us', 'Heard County Schools'), true);
    assert.equal(isLikelySchoolDomain('cps.edu', 'Chicago Public Schools'), true);
  });

  it('rejects known junk when org is a school', () => {
    assert.equal(isLikelySchoolDomain('vegaajans.com.tr', 'Highlands Elementary School'), false);
    assert.equal(isLikelySchoolDomain('thebusinessyear.com', 'Millard Public Schools'), false);
  });

  it('accepts schoolish .com domains', () => {
    assert.equal(
      isLikelySchoolDomain('lakegenevaschools.com', 'Lake Geneva Schools'),
      true,
    );
  });

  it('normalizes domains', () => {
    assert.equal(normalizeDomain('https://www.Example.EDU/path'), 'example.edu');
  });
});

describe('resolveDomainViaSerper fixtures', () => {
  it('returns canned k12 domain in fixture mode', async () => {
    const domain = await resolveDomainViaSerper('Goshen High School', { useFixtures: true });
    assert.equal(domain, 'goshenhighschool.k12.us');
    assert.equal(isLikelySchoolDomain(domain!, 'Goshen High School'), true);
  });
});

describe('createSchoolDomainResolver fixtures', () => {
  it('falls back to serper fixture when apollo domain fails quality', async () => {
    const counter = new CallCounter();
    // Default apollo fixture returns acme-corp.com for any org enrich —
    // for a school name that should fail quality and serper should win.
    const resolve = createSchoolDomainResolver({ useFixtures: true, counter });
    const resolved = await resolve('Goshen High School');
    assert.ok(resolved);
    assert.equal(resolved!.source, 'serper');
    assert.match(resolved!.domain, /\.k12\.us$/);
  });
});
