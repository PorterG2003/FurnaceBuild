import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTn } from './parseTn.js';

const SAMPLE = [
  'sde_schooldistrictname,districts.sde_schooldistrictname,contact.fullname,contact.emailaddress1,address1_city,address1_postalcode,sde_ncesnumber,mshied_schooltype',
  'A Z Kelley Elementary,Metro Nashville Public Schools,Jane Doe,jane.doe@mnps.org,Antioch,37013,470318001234,Traditional Public School',
  'Metro Nashville Public Schools,,John District,superintendent@mnps.org,Nashville,37201,4703180,District',
].join('\n');

describe('parseTn', () => {
  it('reads school principal name and email from the TNSD export', async () => {
    const { rows } = await parseTn(Buffer.from(SAMPLE, 'utf8'), 'directory.csv');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'A Z Kelley Elementary');
    assert.equal(rows[0]!.district_name, 'Metro Nashville Public Schools');
    assert.equal(rows[0]!.first_name, 'Jane');
    assert.equal(rows[0]!.last_name, 'Doe');
    assert.equal(rows[0]!.email, 'jane.doe@mnps.org');
  });
});
