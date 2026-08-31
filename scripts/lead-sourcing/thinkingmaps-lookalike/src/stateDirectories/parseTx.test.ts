import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTx } from './parseTx.js';

const SAMPLE = [
  'Campus Number,Campus Name,District Name,City,Zip,First Name,Last Name,Title,Email,Organization Type',
  '101912001,West High,Houston ISD,Houston,77002,Ana,Ruiz,Principal,ana.ruiz@houstonisd.org,School',
  '101912000,Houston ISD,Houston ISD,Houston,77002,Carl,Curric,Curriculum Director,carl.c@houstonisd.org,District',
  '101912002,East High,Houston ISD,Houston,77003,Pat,Lee,Principal,plee@houstonisd.org,Campus',
].join('\n');

describe('parseTx', () => {
  it('keeps campus principals with email and parks district staff', () => {
    const { rows, districtStaff } = parseTx(SAMPLE);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.email, 'ana.ruiz@houstonisd.org');
    assert.equal(rows[0]!.school_name, 'West High');
    assert.equal(rows[1]!.first_name, 'Pat');
    assert.equal(districtStaff.length, 1);
    assert.equal(districtStaff[0]!.last_name, 'Curric');
    assert.equal(districtStaff[0]!.title, 'Curriculum Director');
  });
});
