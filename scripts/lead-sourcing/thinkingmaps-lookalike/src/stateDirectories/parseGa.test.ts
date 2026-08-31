import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGa } from './parseGa.js';

const SAMPLE = [
  '"District","School","Principal Title","Principal Name","Principal Middle Name","Principal Last Name","School Address","School City","School Zip"',
  '"601-Appling County","0103-Appling County High School","Dr. ","Ben","A. ","Horner","482 Blackshear Hwy","Baxley","31513-6708"',
  '"761-Atlanta Public Schools","0101-Maynard Jackson High School","","Jane","","Doe","801 Glenwood Ave","Atlanta","30316"',
  '"601-Appling County","0177-No Principal School","","","","","680 Blackshear Hwy","Baxley","31513"',
].join('\n');

describe('parseGa', () => {
  it('strips district/school codes and splits principal first/last', () => {
    const { rows } = parseGa(SAMPLE);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.school_name, 'Appling County High School');
    assert.equal(rows[0]!.district_name, 'Appling County');
    assert.equal(rows[0]!.first_name, 'Ben');
    assert.equal(rows[0]!.last_name, 'Horner');
    assert.equal(rows[0]!.city, 'Baxley');
    assert.equal(rows[0]!.state_school_id, '0103');
    assert.equal(rows[1]!.school_name, 'Maynard Jackson High School');
  });
});
