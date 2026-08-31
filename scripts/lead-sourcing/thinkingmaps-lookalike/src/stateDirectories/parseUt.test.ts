import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseUt } from './parseUt.js';

const SAMPLE = JSON.stringify({
  title: 'SchoolsDirectory',
  schools: [
    {
      schoolNumber: '700',
      ncesAgencyId: '4900017',
      ncesSchoolId: '00904',
      schoolName: 'Academy for Math Engineering & Science',
      leaName: 'AMES',
      city: 'SALT LAKE CITY',
      zip: '84121',
      principalName: 'Brett Wilson',
      principalEmail: 'bwilson@ames-slc.org',
      principalTitle: 'Principal',
      isPrivate: false,
      isClosed: 'N',
      isOpenThisSchoolYear: true,
      state: 'UT',
    },
    {
      schoolName: 'Closed School',
      principalName: 'Jane Doe',
      isClosed: 'Y',
      state: 'UT',
    },
  ],
});

describe('parseUt', () => {
  it('reads principal email and builds NCES from agency+school ids', () => {
    const { rows } = parseUt(SAMPLE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.first_name, 'Brett');
    assert.equal(rows[0]!.last_name, 'Wilson');
    assert.equal(rows[0]!.email, 'bwilson@ames-slc.org');
    assert.equal(rows[0]!.nces_school_id, '490001700904');
    assert.equal(rows[0]!.school_name, 'Academy for Math Engineering & Science');
  });
});
