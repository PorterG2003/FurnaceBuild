import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFl } from './parseFl.js';

const SAMPLE = [
  'District Name,School Number,School Name,City,Zip,Principal First Name,Principal Last Name',
  'BROWARD,0121,Coral Springs High,Coral Springs,33065,Rita,Gomez',
  'BROWARD,0122,Nameless School,Coral Springs,33065,,',
].join('\n');

describe('parseFl', () => {
  it('reads principal first/last from an MSID-style csv', async () => {
    const { rows } = await parseFl(Buffer.from(SAMPLE, 'utf8'), 'msid.csv');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Coral Springs High');
    assert.equal(rows[0]!.first_name, 'Rita');
    assert.equal(rows[0]!.last_name, 'Gomez');
    assert.equal(rows[0]!.title, 'Principal');
    assert.equal(rows[0]!.email, '');
    assert.equal(rows[0]!.state_school_id, '0121');
  });
});
