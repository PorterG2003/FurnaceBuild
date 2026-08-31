import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillAllSchools, pickSchoolSlots } from './schoolContacts.js';
import type { ListedSchool, RawSchoolContact } from './types.js';

const school: ListedSchool = {
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

function contact(partial: Partial<RawSchoolContact>): RawSchoolContact {
  return {
    ncessch: school.ncessch,
    leaid: school.leaid,
    school_name: school.school_name,
    first_name: 'A',
    last_name: 'Person',
    title: 'Principal',
    email: 'a.person@school.org',
    linkedin_url: '',
    company: school.school_name,
    phone: '',
    provider: 'quickenrich',
    email_risk: '',
    person_id: '',
    ...partial,
  };
}

describe('pickSchoolSlots', () => {
  it('caps at three, prefers QE over later providers, and rejects teachers/mismatched employers', () => {
    const result = pickSchoolSlots(school, [
      contact({ first_name: 'Maya', last_name: 'Chen', title: 'Curriculum Coordinator', email: 'maya@x.org', person_id: '1' }),
      contact({ first_name: 'Elena', last_name: 'Brooks', title: 'Assistant Principal', email: 'elena@x.org', provider: 'moltsets', person_id: '2' }),
      contact({ first_name: 'Dana', last_name: 'West', title: 'Principal', email: 'dana@x.org', provider: 'apollo', person_id: '3' }),
      contact({ first_name: 'Extra', last_name: 'Coach', title: 'Instructional Coach', email: 'extra@x.org', person_id: '4' }),
      contact({ first_name: 'Sam', last_name: 'Teacher', title: 'Teacher', email: 'sam@x.org', person_id: '5' }),
      contact({ first_name: 'Wrong', last_name: 'Co', title: 'Principal', email: 'wrong@google.com', company: 'Google', person_id: '6' }),
      contact({
        first_name: 'Maya',
        last_name: 'Chen',
        title: 'Curriculum Coordinator',
        email: 'maya@x.org',
        provider: 'apollo',
        person_id: '1b',
      }),
    ]);
    assert.equal(result.picked.length, 3);
    assert.deepEqual(result.picked.map((row) => row.role), ['curriculum', 'assistant_principal', 'principal']);
    assert.equal(result.picked[0]!.provider, 'quickenrich');
    assert.equal(result.picked.some((row) => row.last_name === 'Teacher'), false);
    assert.equal(result.picked.some((row) => row.company === 'Google'), false);
    assert.ok(result.rejected >= 2);
  });

  it('prefers a directory email over a state-agency record for the same person', () => {
    const result = pickSchoolSlots(school, [
      contact({
        first_name: 'Dana',
        last_name: 'West',
        title: 'Principal',
        email: 'dana.west@school.org',
        provider: 'state_agency',
        person_id: 'state',
      }),
      contact({
        first_name: 'Dana',
        last_name: 'West',
        title: 'Principal',
        email: 'dana.west@school.org',
        provider: 'directory',
        person_id: 'dir',
      }),
    ]);
    assert.equal(result.picked.length, 1);
    assert.equal(result.picked[0]!.provider, 'directory');
  });

  it('backfills a stronger role when a preferred slot is empty', () => {
    const result = pickSchoolSlots(school, [
      contact({ first_name: 'Ann', last_name: 'One', title: 'Assistant Principal', email: 'ann@x.org', person_id: 'a' }),
      contact({ first_name: 'Bob', last_name: 'Two', title: 'Vice Principal', email: 'bob@x.org', person_id: 'b' }),
      contact({ first_name: 'Cara', last_name: 'Three', title: 'Principal', email: 'cara@x.org', person_id: 'c' }),
    ]);
    assert.equal(result.picked.length, 3);
    assert.equal(result.picked.filter((row) => row.role === 'assistant_principal').length, 2);
  });
});

describe('fillAllSchools', () => {
  it('does not emit contacts for excluded schools', () => {
    const excluded = { ...school, ncessch: '062964000001', school_name: 'Palm Tree Elementary', excluded: true };
    const filled = fillAllSchools({
      schools: [school],
      contacts: [
        contact({ ncessch: excluded.ncessch, school_name: excluded.school_name, first_name: 'Skip', email: 'skip@x.org' }),
        contact({ first_name: 'Keep', last_name: 'Me', email: 'keep@x.org', person_id: 'keep' }),
      ],
    });
    assert.equal(filled.picked.every((row) => row.ncessch !== excluded.ncessch), true);
    assert.equal(filled.picked[0]!.first_name, 'Keep');
  });
});
