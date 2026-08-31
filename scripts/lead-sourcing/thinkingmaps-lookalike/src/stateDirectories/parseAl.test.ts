import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAl } from './parseAl.js';

const SAMPLE = [
  'School Name,System Name,Administrator,City,Zip,Email',
  'Auburn High School,Auburn City,Steve Mask,Auburn,36830,smask@auburnschools.org',
  'Empty Admin School,Auburn City,,Auburn,36830,',
].join('\n');

describe('parseAl', () => {
  it('reads administrator names from the ALSDE siteinfo export', async () => {
    const { rows } = await parseAl(Buffer.from(SAMPLE, 'utf8'), 'sites.csv');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Auburn High School');
    assert.equal(rows[0]!.first_name, 'Steve');
    assert.equal(rows[0]!.last_name, 'Mask');
    assert.equal(rows[0]!.email, 'smask@auburnschools.org');
  });
});
