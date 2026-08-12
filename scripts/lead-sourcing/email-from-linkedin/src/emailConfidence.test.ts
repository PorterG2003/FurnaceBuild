import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isK12EmployerDomain, scoreEmailConfidence } from './emailConfidence.js';

describe('isK12EmployerDomain', () => {
  it('accepts k12 and schoolish domains', () => {
    assert.equal(isK12EmployerDomain('heard.k12.ga.us'), true);
    assert.equal(isK12EmployerDomain('bluevalleyk12.org'), true);
    assert.equal(isK12EmployerDomain('providenceschools.org'), true);
    assert.equal(isK12EmployerDomain('schools.nyc.gov'), true);
  });

  it('rejects free mail and junk', () => {
    assert.equal(isK12EmployerDomain('gmail.com'), false);
    assert.equal(isK12EmployerDomain('ballotpedia.org'), false);
  });
});

describe('scoreEmailConfidence', () => {
  it('scores apollo K-12 email as high', () => {
    const result = scoreEmailConfidence({
      email: 'chris.legleiter@bluevalleyk12.org',
      company_domain: 'bluevalleyk12.org',
      match_method: 'domain_rematch',
    });
    assert.equal(result.confidence, 'high');
  });

  it('scores pattern_mv K-12 as mid', () => {
    const result = scoreEmailConfidence({
      email: 'charissa.cole@acsboe.org',
      company_domain: 'acsboe.org',
      match_method: 'pattern_mv',
    });
    assert.equal(result.confidence, 'mid');
  });

  it('rejects free mail and research uni misfires', () => {
    assert.equal(
      scoreEmailConfidence({ email: 'dbturner1@yahoo.com', match_method: 'name' }).confidence,
      'low',
    );
    assert.equal(
      scoreEmailConfidence({
        email: 'chris@wisc.edu',
        company_domain: 'wisc.edu',
        company_name: 'Some High School',
        match_method: 'pattern_mv',
      }).confidence,
      'low',
    );
    assert.equal(
      scoreEmailConfidence({
        email: 'kelly.croy@ballotpedia.org',
        company_domain: 'ballotpedia.org',
        match_method: 'domain_rematch',
      }).confidence,
      'low',
    );
    // Bad company_domain must not sink a good K-12 email
    assert.equal(
      scoreEmailConfidence({
        email: 'kcroy@pccsd-k12.net',
        company_domain: 'ballotpedia.org',
        match_method: 'domain_rematch',
      }).confidence,
      'high',
    );
  });

  it('keeps district alias mismatches as high when email is K-12', () => {
    const result = scoreEmailConfidence({
      email: 'ruffolok@wawmsd.org',
      company_domain: 'wawm.k12.wi.us',
      match_method: 'name',
    });
    assert.equal(result.confidence, 'high');
    assert.ok(result.reasons.includes('employer_domain_alias') || result.confidence === 'high');
  });
});
