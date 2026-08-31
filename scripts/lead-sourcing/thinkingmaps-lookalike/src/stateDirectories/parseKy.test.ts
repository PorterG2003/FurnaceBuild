import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKy } from './parseKy.js';

const SAMPLE = [
  'District Code,District Name,School Code,School Name,Principal First Name,Principal Last Name,City,Zipcode,Role Title',
  '001,Adair County,010,Adair County High School,Chad,Parnell,Columbia,42728,Principal',
  '001,Adair County,016,No Name School,,,Columbia,42728,Principal',
].join('\n');

describe('parseKy', () => {
  it('reads principal first/last from the Open House export', () => {
    const { rows } = parseKy(SAMPLE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Adair County High School');
    assert.equal(rows[0]!.first_name, 'Chad');
    assert.equal(rows[0]!.last_name, 'Parnell');
    assert.equal(rows[0]!.district_name, 'Adair County');
    assert.equal(rows[0]!.state_school_id, '010');
  });
});
