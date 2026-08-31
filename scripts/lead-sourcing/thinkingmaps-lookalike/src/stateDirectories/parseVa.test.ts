import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVa } from './parseVa.js';

const SAMPLE = `
<tr class="division_heading">
  <td class="division" colspan="5"><a name='Accomack County Public Schools' title='Accomack County Public Schools'></a></td>
</tr>
<tr>
  <td class="td_column_wrapstyle"><strong>Accawmacke Elementary</strong><br/>Street address:<br/>26230 Drummondtown Rd<br/>Accomac, VA  23301<br/>757-787-8013</td>
  <td class="td_column_wrapstyle">Mr. Timothy  Young </td>
  <td>PK-5</td>
  <td>Elementary</td>
</tr>
<tr>
  <td class="td_column_wrapstyle"><strong>Vacant School</strong><br/>Nowhere, VA  23301</td>
  <td class="td_column_wrapstyle">Position Vacant</td>
  <td>PK-5</td>
  <td>Elementary</td>
</tr>
`;

describe('parseVa', () => {
  it('reads principal names and city/zip from the division HTML tables', () => {
    const { rows } = parseVa(SAMPLE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Accawmacke Elementary');
    assert.equal(rows[0]!.first_name, 'Timothy');
    assert.equal(rows[0]!.last_name, 'Young');
    assert.equal(rows[0]!.district_name, 'Accomack County Public Schools');
    assert.equal(rows[0]!.city, 'Accomac');
    assert.equal(rows[0]!.zip, '23301');
  });
});
