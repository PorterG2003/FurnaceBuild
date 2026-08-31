import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCa } from './parseCa.js';

const SAMPLE = [
  'CDSCode\tNCESDist\tNCESSchool\tStatusType\tDistrict\tSchool\tCity\tZip\tAdmFName\tAdmLName',
  '19647336012345\t0622710\t00123\tActive\tLos Angeles Unified\tSuder Elementary\tLos Angeles\t90001\tJane\tDoe',
  '19647336088888\t0622710\t00888\tActive\tLos Angeles Unified\tQuote School\tLos Angeles\t90003\tRamon "Ray"\tGamez',
  '19647330000000\t0622710\t\tActive\tLos Angeles Unified\t\tLos Angeles\t90001\tBob\tSuperintendent',
  '19647336019999\t0622710\t00199\tClosed\tLos Angeles Unified\tOld School\tLos Angeles\t90001\tGone\tPerson',
  '19647336011111\t0622710\t00111\tActive\tLos Angeles Unified\tNo Admin School\tLos Angeles\t90001\t\t',
  '19647336055555\tNo Data\tNo Data\tActive\tLos Angeles Unified\tMt Zion Hs\tLos Angeles\t90002\tMaya\tChen',
].join('\n');

describe('parseCa', () => {
  it('keeps active schools with administrator names and builds NCES ids', () => {
    const { rows, districtStaff } = parseCa(SAMPLE);
    assert.equal(districtStaff.length, 0);
    assert.equal(rows.length, 3);
    const suder = rows.find((row) => row.school_name === 'Suder Elementary');
    assert.ok(suder);
    assert.equal(suder.first_name, 'Jane');
    assert.equal(suder.last_name, 'Doe');
    assert.equal(suder.title, 'Principal');
    assert.equal(suder.nces_school_id, '062271000123');
    assert.equal(suder.state_school_id, '19647336012345');
    assert.equal(suder.email, '');
    const ray = rows.find((row) => row.last_name === 'Gamez');
    assert.ok(ray);
    assert.equal(ray.first_name, 'Ramon');
  });

  it('skips district records, closed schools, and rows without a name', () => {
    const { rows } = parseCa(SAMPLE);
    assert.equal(rows.some((row) => row.last_name === 'Superintendent'), false);
    assert.equal(rows.some((row) => row.school_name === 'Old School'), false);
    assert.equal(rows.some((row) => row.school_name === 'No Admin School'), false);
    const zion = rows.find((row) => row.school_name === 'Mt Zion Hs');
    assert.ok(zion);
    assert.equal(zion.nces_school_id, '');
  });
});
