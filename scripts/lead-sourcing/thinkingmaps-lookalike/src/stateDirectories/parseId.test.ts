import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseId } from './parseId.js';

const SAMPLE = [
  'Textbox9',
  '388',
  'Last_Name1,First_Name,Position,Email,City,Zip1,District_Name,School_Name,School_ID',
  'AUBREY,JAMIE KAY,PRINCIPAL,jamie.aubrey@academycharter.net,Chubbuck,83202,THE ACADEMY INC.,CONNOR ACADEMY,0641',
  'ADAMS,DARCI D,ELL/MIGRANT COORDINATOR,ddadams@kunaschools.org,Kuna,83634,KUNA JOINT DISTRICT,ADMINISTRATION BUILDING KUNA JOINT DISTRICT,3003',
].join('\n');

describe('parseId', () => {
  it('keeps principal rows and skips Title III / admin-building contacts', () => {
    const { rows } = parseId(SAMPLE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'CONNOR ACADEMY');
    assert.equal(rows[0]!.first_name, 'JAMIE KAY');
    assert.equal(rows[0]!.last_name, 'AUBREY');
    assert.equal(rows[0]!.email, 'jamie.aubrey@academycharter.net');
  });
});
