import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attributePerson } from './schoolAttribution.js';
import { emailMatchesDistrict, qaPerson } from './directoryQa.js';
import type { HarvestedPerson } from './adapters/types.js';
import type { ListedSchool } from './types.js';

const tumbleweed: ListedSchool = {
  ncessch: '062964000003',
  leaid: '0629640',
  school_name: 'Tumbleweed Elementary',
  state: 'CA',
  city: 'Palmdale',
  zip: '93551',
  lea_name: 'Palmdale School District',
  excluded: false,
  exclude_reason: '',
  won_account_id: '',
  won_account_name: '',
  match_confidence: '',
  match_score: '',
};

const palmtree: ListedSchool = {
  ...tumbleweed,
  ncessch: '062964000001',
  school_name: 'Palm Tree Elementary',
  excluded: true,
  exclude_reason: 'closed_won_school',
};

function person(partial: Partial<HarvestedPerson>): HarvestedPerson {
  return {
    first_name: 'Elena',
    last_name: 'Brooks',
    title: 'Assistant Principal',
    email: 'elena.brooks@palmdalesd.org',
    school_hint: 'Tumbleweed Elementary',
    source_url: 'https://www.palmdalesd.org/directory',
    evidence: 'location_field',
    platform: 'finalsite',
    ...partial,
  };
}

describe('schoolAttribution', () => {
  it('attaches a location field to the NCES school and never guesses a lone school', () => {
    const hit = attributePerson(person({}), [tumbleweed, palmtree]);
    assert.equal(hit.contact?.ncessch, '062964000003');
    const missing = attributePerson(person({ school_hint: '', source_url: 'https://www.palmdalesd.org/directory' }), [
      tumbleweed,
    ]);
    assert.equal(missing.contact, null);
    assert.equal(missing.review_reason, 'missing_school_hint');
  });

  it('maps school abbreviations onto NCES names in the same district', () => {
    const concord: ListedSchool = {
      ...tumbleweed,
      ncessch: '360318000001',
      leaid: '3603180',
      school_name: 'Concord Road Elementary School',
      state: 'NY',
      lea_name: 'Ardsley Union Free School District',
    };
    const middle: ListedSchool = {
      ...concord,
      ncessch: '360318000081',
      school_name: 'Ardsley Middle School',
    };
    const high: ListedSchool = {
      ...concord,
      ncessch: '360318000002',
      school_name: 'Ardsley High School',
      excluded: true,
      exclude_reason: 'closed_won_school',
    };
    const ams = attributePerson(person({ school_hint: 'AMS', title: 'Principal' }), [concord, middle, high]);
    assert.equal(ams.contact?.ncessch, '360318000081');
    const crs = attributePerson(person({ school_hint: 'CRS', title: 'Principal' }), [concord, middle, high]);
    assert.equal(crs.contact?.ncessch, '360318000001');
    const ahs = attributePerson(person({ school_hint: 'AHS', title: 'Principal' }), [concord, middle, high]);
    assert.equal(ahs.contact, null);
    assert.equal(ahs.review_reason, 'excluded_school');
  });

  it('does not treat a district directory path as a school hint', () => {
    const missing = attributePerson(
      person({
        school_hint: '',
        source_url: 'https://www.pbvusd.k12.ca.us/about-us/contact-us/directory?const_search_keyword=principal',
      }),
      [tumbleweed],
    );
    assert.equal(missing.contact, null);
    assert.equal(missing.review_reason, 'missing_school_hint');
  });

  it('uses a school subdomain as the hint', () => {
    const rhoden: ListedSchool = {
      ...tumbleweed,
      ncessch: '482517000001',
      leaid: '4825170',
      school_name: 'Rhoden Academy Elementary',
      state: 'TX',
      lea_name: 'Katy ISD',
    };
    const hit = attributePerson(
      person({
        school_hint: '',
        evidence: 'school_url',
        source_url: 'https://rae.katyisd.org/our-campus/directory',
        email: 'laura@katyisd.org',
      }),
      [rhoden, tumbleweed],
    );
    assert.equal(hit.contact?.ncessch, '482517000001');
  });

  it('splits comma-separated school lists and keeps the first unique match', () => {
    const harper: ListedSchool = { ...tumbleweed, ncessch: '130123000001', leaid: '1301230', school_name: 'Harper Elementary', state: 'GA' };
    const kilpatrick: ListedSchool = { ...harper, ncessch: '130123000002', school_name: 'Kilpatrick Elementary' };
    const king: ListedSchool = { ...harper, ncessch: '130123000003', school_name: 'King Elementary' };
    const hit = attributePerson(
      person({ school_hint: 'Harper Es, Kilpatrick Es, King Es', title: 'Principal-Elementary' }),
      [harper, kilpatrick, king],
    );
    assert.equal(hit.contact?.ncessch, '130123000001');
    assert.equal(hit.contact?.school_name, 'Harper Elementary');
  });

  it('uses the title grade level to pick among split hints', () => {
    const high: ListedSchool = { ...tumbleweed, ncessch: '130123000010', leaid: '1301230', school_name: 'Mt Zion High School', state: 'GA' };
    const primary: ListedSchool = { ...high, ncessch: '130123000011', school_name: 'Mt Zion Primary' };
    const hit = attributePerson(
      person({ school_hint: 'Mt Zion Hs, Mt Zion Primary', title: 'Ast Principal-High School' }),
      [high, primary],
    );
    assert.equal(hit.contact?.ncessch, '130123000010');
  });

  it('leaves a district-office fragment unmatched instead of guessing a school', () => {
    const harper: ListedSchool = { ...tumbleweed, ncessch: '130123000001', leaid: '1301230', school_name: 'Harper Elementary', state: 'GA' };
    const miss = attributePerson(
      person({ school_hint: 'Professional Learning, Chief Of Schools', title: 'Assistant Principal' }),
      [harper, { ...harper, ncessch: '130123000002', school_name: 'Kilpatrick Elementary' }],
    );
    assert.equal(miss.contact, null);
    assert.equal(miss.review_reason, 'low_school_score');
  });
});

describe('directoryQa', () => {
  it('keeps district-domain leadership emails and drops teachers and foreign domains', () => {
    assert.equal(emailMatchesDistrict('elena.brooks@palmdalesd.org', 'www.palmdalesd.org'), true);
    assert.equal(emailMatchesDistrict('mericksen@alpinedistrict.org', 'alpineschools.org'), true);
    assert.equal(qaPerson(person({}), { siteHost: 'palmdalesd.org' }).ok, true);
    assert.equal(qaPerson(person({ title: '3rd Grade Teacher' }), { siteHost: 'palmdalesd.org' }).ok, false);
    assert.equal(qaPerson(person({ email: 'someone@gmail.com' }), { siteHost: 'palmdalesd.org' }).ok, false);
  });
});
