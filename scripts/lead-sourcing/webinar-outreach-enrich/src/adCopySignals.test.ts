import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractAdCopySignals } from './adCopySignals.js';
import { normalizeDomain } from './types.js';

describe('adCopySignals', () => {
  it('extracts usable domains from URLs and emails in copy', () => {
    const s = extractAdCopySignals({
      company_name: 'Genio',
      ad_copy: 'Register at WWW.GENIO.CO/STEM-WEBINAR or email hello@genio.co',
    });
    assert.ok(s.domains.includes('genio.co'));
    assert.equal(s.only_generic_urls, false);
  });

  it('extracts bare ALLCAPS hosts without http/www', () => {
    const s = extractAdCopySignals({
      company_name: 'Early Life Nutrition Alliance',
      ad_copy: 'Join free. EARLYLIFENUTRITIONALLIANCE.COM/WEBINAR Are you a dietitian?',
    });
    assert.ok(s.domains.includes('earlylifenutritionalliance.com'));
    const latib = extractAdCopySignals({
      company_name: 'Hakim Dr Latib',
      ad_copy: 'Register: DRLATIB.COM/WEBINAR tonight',
    });
    assert.ok(latib.domains.includes('drlatib.com'));
  });

  it('marks lnkd.in / forms.gle as only_generic_urls', () => {
    const s = extractAdCopySignals({
      company_name: 'Someone',
      ad_copy: 'Sign up https://lnkd.in/abc123 or https://forms.gle/xyz',
    });
    assert.equal(s.domains.length, 0);
    assert.equal(s.only_generic_urls, true);
  });

  it('prefers org alias when advertiser looks person-like', () => {
    const s = extractAdCopySignals({
      company_name: 'Anna Funk',
      ad_copy:
        'Registration is now open for the fall cohort of my short course for the Association for Advancing Participatory Sciences: Strategic Communication.',
    });
    assert.equal(s.advertiser_looks_person_like, true);
    assert.ok(
      s.org_aliases.some((a) => /Association for Advancing Participatory Sciences/i.test(a)),
    );
    assert.match(s.best_company_query, /Association for Advancing/i);
  });

  it('keeps company advertiser as query when not person-like', () => {
    const s = extractAdCopySignals({
      company_name: 'Ace Handyman Services',
      ad_copy: 'Discover how Ace franchising puts you in control. Join Ace today.',
    });
    assert.equal(s.advertiser_looks_person_like, false);
    assert.equal(s.best_company_query, 'Ace Handyman Services');
  });
});

describe('GENERIC webinar hosts', () => {
  it('rejects gotowebinar, demio, zurl, ow.ly', () => {
    assert.equal(normalizeDomain('https://gotowebinar.com/register'), '');
    assert.equal(normalizeDomain('demio.com'), '');
    assert.equal(normalizeDomain('zurl.co'), '');
    assert.equal(normalizeDomain('ow.ly'), '');
  });
});
